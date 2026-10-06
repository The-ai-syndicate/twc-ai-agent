-- ============================================================================
-- TWC AI Assistant - 0002 atomic booking / cancel / reschedule functions
-- All operate in a SINGLE transaction, lock the slot row with SELECT ... FOR
-- UPDATE, check capacity, and write audit_log. client_id comes from the caller
-- (verified session), never from the model.
-- ============================================================================

-- Reference generator: TWC-A-NNNNN
create sequence if not exists appointment_ref_seq start 20000;
create or replace function next_appointment_reference()
returns text language sql as $$
  select 'TWC-A-' || nextval('appointment_ref_seq')::text;
$$;

-- ---------------------------------------------------------------------------
-- book_slot(slot_id, client_id, notes?)
-- ---------------------------------------------------------------------------
create or replace function book_slot(
  p_slot_id uuid,
  p_client_id uuid,
  p_notes text default null,
  p_channel text default 'web'
) returns appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot availability_slots;
  v_appt appointments;
  v_ref text;
  v_service services;
  v_site sites;
begin
  -- Lock the row so two concurrent callers cannot both pass the capacity check.
  select * into v_slot from availability_slots where id = p_slot_id for update;
  if not found then
    raise exception 'SLOT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_slot.starts_at < now() then
    raise exception 'SLOT_IN_PAST' using errcode = 'P0003';
  end if;

  if v_slot.booked >= v_slot.capacity then
    raise exception 'SLOT_FULL' using errcode = 'P0004';
  end if;

  update availability_slots set booked = booked + 1 where id = p_slot_id;

  select * into v_service from services where id = v_slot.service_id;
  select * into v_site from sites where id = v_slot.site_id;

  v_ref := next_appointment_reference();

  insert into appointments (reference, client_id, site_id, service_id, slot_id, starts_at, status, channel, notes)
  values (v_ref, p_client_id, v_slot.site_id, v_slot.service_id, v_slot.id, v_slot.starts_at, 'booked', p_channel, p_notes)
  returning * into v_appt;

  -- Reminder uses the service neutral_label so no sensitive wording leaks.
  insert into reminders (client_id, appointment_id, type, send_at, status)
  values (p_client_id, v_appt.id, 'appointment', v_slot.starts_at - interval '24 hours', 'scheduled');

  insert into audit_log (actor, action, entity, entity_id, meta)
  values (p_client_id::text, 'appointment.book', 'appointment', v_appt.id::text,
          jsonb_build_object('reference', v_ref, 'slot_id', p_slot_id, 'site', v_site.code, 'service', v_service.code));

  return v_appt;
end $$;

-- ---------------------------------------------------------------------------
-- cancel_appointment(reference, client_id)
-- ---------------------------------------------------------------------------
create or replace function cancel_appointment(
  p_reference text,
  p_client_id uuid
) returns appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt appointments;
begin
  select * into v_appt from appointments
    where reference = p_reference and client_id = p_client_id
    for update;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_appt.status in ('cancelled') then
    raise exception 'ALREADY_CANCELLED' using errcode = 'P0005';
  end if;

  if v_appt.slot_id is not null then
    -- Free the slot (guarded so booked never goes below zero).
    update availability_slots
      set booked = greatest(booked - 1, 0)
      where id = v_appt.slot_id;
  end if;

  update appointments
    set status = 'cancelled', updated_at = now()
    where id = v_appt.id
    returning * into v_appt;

  update reminders set status = 'cancelled' where appointment_id = v_appt.id and status = 'scheduled';

  insert into audit_log (actor, action, entity, entity_id, meta)
  values (p_client_id::text, 'appointment.cancel', 'appointment', v_appt.id::text,
          jsonb_build_object('reference', p_reference));

  return v_appt;
end $$;

-- ---------------------------------------------------------------------------
-- reschedule_appointment(reference, new_slot_id, client_id)
-- Frees the old slot and takes the new one atomically.
-- ---------------------------------------------------------------------------
create or replace function reschedule_appointment(
  p_reference text,
  p_new_slot_id uuid,
  p_client_id uuid
) returns appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt appointments;
  v_slot availability_slots;
begin
  select * into v_appt from appointments
    where reference = p_reference and client_id = p_client_id
    for update;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_appt.status not in ('booked','confirmed','rescheduled') then
    raise exception 'APPOINTMENT_NOT_ACTIVE' using errcode = 'P0006';
  end if;

  select * into v_slot from availability_slots where id = p_new_slot_id for update;
  if not found then
    raise exception 'SLOT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_slot.starts_at < now() then
    raise exception 'SLOT_IN_PAST' using errcode = 'P0003';
  end if;
  if v_slot.booked >= v_slot.capacity then
    raise exception 'SLOT_FULL' using errcode = 'P0004';
  end if;

  -- Free old slot
  if v_appt.slot_id is not null and v_appt.slot_id <> p_new_slot_id then
    update availability_slots set booked = greatest(booked - 1, 0) where id = v_appt.slot_id;
  end if;

  -- Take new slot
  update availability_slots set booked = booked + 1 where id = p_new_slot_id;

  update appointments
    set slot_id = p_new_slot_id,
        site_id = v_slot.site_id,
        service_id = v_slot.service_id,
        starts_at = v_slot.starts_at,
        status = 'rescheduled',
        updated_at = now()
    where id = v_appt.id
    returning * into v_appt;

  update reminders set status = 'cancelled' where appointment_id = v_appt.id and status = 'scheduled';
  insert into reminders (client_id, appointment_id, type, send_at, status)
  values (v_appt.client_id, v_appt.id, 'appointment', v_slot.starts_at - interval '24 hours', 'scheduled');

  insert into audit_log (actor, action, entity, entity_id, meta)
  values (p_client_id::text, 'appointment.reschedule', 'appointment', v_appt.id::text,
          jsonb_build_object('reference', p_reference, 'new_slot_id', p_new_slot_id));

  return v_appt;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers for the retrieval layer (public site/service info)
-- ---------------------------------------------------------------------------
create or replace function available_slot_count(p_site_id uuid, p_service_id uuid)
returns int language sql stable as $$
  select coalesce(sum(capacity - booked), 0)::int
  from availability_slots
  where site_id = p_site_id and service_id = p_service_id and starts_at > now();
$$;

grant execute on function book_slot(uuid, uuid, text, text) to service_role;
grant execute on function cancel_appointment(text, uuid) to service_role;
grant execute on function reschedule_appointment(text, uuid, uuid) to service_role;

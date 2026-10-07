-- ============================================================================
-- TWC AI Assistant - 0008 appointment email + casual cancel support
-- Adds:
--   * appointments.contact_email  -> where we email the confirmation/details.
--   * appointments_details(reference) -> read-only lookup for one appointment
--     joined with site/service names (used to render / email the summary and
--     to power "cancel by giving the assistant the appointment id").
--   * cancel_appointment_by_reference(reference) -> cancels by reference alone.
--     Used ONLY for the in-chat "I want to cancel TWC-A-XXXXX" path where the
--     client quotes their own id. It frees the slot and cancels reminders just
--     like cancel_appointment, but does not require a client_id match so the
--     casual flow works before/without phone verification (demo).
-- All times are Africa/Gaborone (UTC+2).
-- ============================================================================

-- ---------- appointments.contact_email ----------
alter table if exists public.appointments
  add column if not exists contact_email text;

-- ---------- appointments_details(reference) ----------
-- Returns a single row with everything needed to display/confirm an appt.
create or replace function appointments_details(p_reference text)
returns table (
  id uuid,
  reference text,
  status text,
  starts_at timestamptz,
  site_code text,
  site_name text,
  site_town text,
  site_phone text,
  service_code text,
  service_name text,
  neutral_label text,
  contact_email text,
  client_id uuid
)
language sql stable
as $$
  select
    a.id, a.reference, a.status, a.starts_at,
    s.code, s.name, s.town, s.phone,
    sv.code, sv.name, sv.neutral_label,
    a.contact_email, a.client_id
  from appointments a
  left join sites s on s.id = a.site_id
  left join services sv on sv.id = a.service_id
  where a.reference = p_reference
  limit 1;
$$;

-- ---------- cancel_appointment_by_reference(reference) ----------
create or replace function cancel_appointment_by_reference(p_reference text)
returns appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt appointments;
begin
  select * into v_appt from appointments
    where reference = p_reference
    for update;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_appt.status = 'cancelled' then
    raise exception 'ALREADY_CANCELLED' using errcode = 'P0005';
  end if;

  if v_appt.slot_id is not null then
    update availability_slots
      set booked = greatest(booked - 1, 0)
      where id = v_appt.slot_id;
  end if;

  update appointments
    set status = 'cancelled', updated_at = now()
    where id = v_appt.id
    returning * into v_appt;

  update reminders set status = 'cancelled'
    where appointment_id = v_appt.id and status = 'scheduled';

  insert into audit_log (actor, action, entity, entity_id, meta)
  values (
    coalesce(v_appt.client_id::text, 'system'),
    'appointment.cancel.casual',
    'appointment',
    v_appt.id::text,
    jsonb_build_object('reference', p_reference)
  );

  return v_appt;
end $$;

-- ---------- set_appointment_email(reference, email) ----------
create or replace function set_appointment_email(p_reference text, p_email text)
returns appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt appointments;
begin
  update appointments
    set contact_email = p_email, updated_at = now()
    where reference = p_reference
    returning * into v_appt;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_appt;
end $$;

grant execute on function appointments_details(text) to service_role;
grant execute on function cancel_appointment_by_reference(text) to service_role;
grant execute on function set_appointment_email(text, text) to service_role;

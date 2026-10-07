-- ============================================================================
-- TWC AI Assistant - 0007 in-chat appointment calendar support
-- Adds:
--   * month_slot_summary(site, service, year, month) -> per-day availability
--     so the in-chat calendar can render ANY month / ANY year without pulling
--     every slot row to the browser.
--   * ensure_slot(site, service, starts_at, capacity) -> idempotently create a
--     bookable slot (used when a client picks a day/time the seed data did not
--     pre-generate, e.g. a far-future month).
--   * book_appointment_at(site, service, starts_at, client, notes) -> atomic
--     book that lazily creates the slot then delegates to book_slot semantics.
-- All times are Africa/Gaborone (UTC+2). client_id always comes from the caller
-- (verified session), never from the model.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- month_slot_summary: one row per day in the requested month with open counts.
-- "open" = capacity - booked for slots in the future (or today onwards).
-- ---------------------------------------------------------------------------
create or replace function month_slot_summary(
  p_site_id uuid,
  p_service_id uuid,
  p_year int,
  p_month int   -- 1..12
) returns table (
  day date,
  open_slots int,
  first_slot timestamptz,
  last_slot timestamptz
)
language sql stable
as $$
  with bounds as (
    select
      make_date(p_year, p_month, 1)                      as m_start,
      (make_date(p_year, p_month, 1) + interval '1 month') as m_end
  )
  select
    (s.starts_at at time zone 'Africa/Gaborone')::date as day,
    coalesce(sum(s.capacity - s.booked), 0)::int        as open_slots,
    min(s.starts_at)                                    as first_slot,
    max(s.starts_at)                                    as last_slot
  from availability_slots s, bounds b
  where s.site_id = p_site_id
    and s.service_id = p_service_id
    and s.starts_at >= b.m_start
    and s.starts_at <  b.m_end
    and s.starts_at > now()
    and s.booked < s.capacity
  group by day
  order by day;
$$;

-- ---------------------------------------------------------------------------
-- ensure_slot: create a slot if none exists for (site, service, starts_at).
-- Uses default 30-min duration and capacity 2 (matching seed data). Idempotent
-- thanks to the unique(site_id, service_id, starts_at) constraint.
-- ---------------------------------------------------------------------------
create or replace function ensure_slot(
  p_site_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_capacity int default 2,
  p_duration_min int default 30
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from availability_slots
   where site_id = p_site_id and service_id = p_service_id and starts_at = p_starts_at;
  if found then
    return v_id;
  end if;

  insert into availability_slots (site_id, service_id, starts_at, ends_at, capacity, booked)
  values (p_site_id, p_service_id, p_starts_at, p_starts_at + make_interval(mins => p_duration_min), p_capacity, 0)
  on conflict (site_id, service_id, starts_at) do update set capacity = availability_slots.capacity
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- book_appointment_at: lazily ensure the slot, then book it atomically for the
-- given client. Mirrors book_slot's capacity/past checks. Returns the appt row.
-- ---------------------------------------------------------------------------
create or replace function book_appointment_at(
  p_site_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_client_id uuid,
  p_notes text default null,
  p_channel text default 'web'
) returns appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_id uuid;
begin
  if p_starts_at < now() then
    raise exception 'SLOT_IN_PAST' using errcode = 'P0003';
  end if;

  v_slot_id := ensure_slot(p_site_id, p_service_id, p_starts_at);

  return book_slot(v_slot_id, p_client_id, p_notes, p_channel);
end $$;

grant execute on function month_slot_summary(uuid, uuid, int, int) to service_role;
grant execute on function ensure_slot(uuid, uuid, timestamptz, int, int) to service_role;
grant execute on function book_appointment_at(uuid, uuid, timestamptz, uuid, text, text) to service_role;

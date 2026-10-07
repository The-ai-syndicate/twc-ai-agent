import { serviceClient } from '@/lib/supabase/server';

// Calendar availability helpers for the in-chat appointment calendar.
// Pure read helpers — client_id is never involved here (availability is public
// TWC service info). Booking authorization happens in the book route.

export type MonthDay = {
  day: string; // ISO date (YYYY-MM-DD)
  openSlots: number;
  firstSlot: string | null;
  lastSlot: string | null;
};

export type MonthSummary = {
  siteCode: string;
  serviceCode: string;
  siteName: string | null;
  serviceName: string | null;
  year: number;
  month: number; // 1..12
  days: MonthDay[];
};

export async function getMonthSummary(
  siteCode: string,
  serviceCode: string,
  year: number,
  month: number,
): Promise<MonthSummary> {
  const db = serviceClient();

  const [{ data: site }, { data: service }] = await Promise.all([
    db.from('sites').select('id,name').eq('code', siteCode).maybeSingle(),
    db.from('services').select('id,name').eq('code', serviceCode).maybeSingle(),
  ]);

  const siteId = (site as { id: string } | null)?.id ?? null;
  const serviceId = (service as { id: string } | null)?.id ?? null;

  const base: MonthSummary = {
    siteCode,
    serviceCode,
    siteName: (site as { name: string } | null)?.name ?? null,
    serviceName: (service as { name: string } | null)?.name ?? null,
    year,
    month,
    days: [],
  };

  if (!siteId || !serviceId) return base;

  const { data, error } = await db.rpc('month_slot_summary', {
    p_site_id: siteId,
    p_service_id: serviceId,
    p_year: year,
    p_month: month,
  });
  if (error || !data) return base;

  type Row = { day: string; open_slots: number; first_slot: string | null; last_slot: string | null };
  base.days = (data as Row[]).map((r) => ({
    day: typeof r.day === 'string' ? r.day.slice(0, 10) : String(r.day),
    openSlots: Number(r.open_slots ?? 0),
    firstSlot: r.first_slot ?? null,
    lastSlot: r.last_slot ?? null,
  }));
  return base;
}

export type DaySlot = { id: string; startsAt: string; endsAt: string; remaining: number };

export async function getDaySlots(
  siteCode: string,
  serviceCode: string,
  dayIso: string, // YYYY-MM-DD (Africa/Gaborone)
): Promise<DaySlot[]> {
  const db = serviceClient();

  const [{ data: site }, { data: service }] = await Promise.all([
    db.from('sites').select('id').eq('code', siteCode).maybeSingle(),
    db.from('services').select('id').eq('code', serviceCode).maybeSingle(),
  ]);
  const siteId = (site as { id: string } | null)?.id ?? null;
  const serviceId = (service as { id: string } | null)?.id ?? null;
  if (!siteId || !serviceId) return [];

  // Day window in Africa/Gaborone (UTC+2) -> convert to UTC instants.
  const start = `${dayIso}T00:00:00+02:00`;
  const end = `${dayIso}T23:59:59+02:00`;

  const { data, error } = await db
    .from('availability_slots')
    .select('id,starts_at,ends_at,capacity,booked')
    .eq('site_id', siteId)
    .eq('service_id', serviceId)
    .gte('starts_at', start)
    .lte('starts_at', end)
    .order('starts_at');
  if (error || !data) return [];

  type Row = { id: string; starts_at: string; ends_at: string; capacity: number; booked: number };
  return (data as Row[])
    .map((r) => ({
      id: r.id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      remaining: Math.max(0, Number(r.capacity) - Number(r.booked)),
    }))
    .filter((s) => s.remaining > 0 && new Date(s.startsAt).getTime() > Date.now());
}

import { NextRequest } from 'next/server';
import { getMonthSummary, getDaySlots } from '@/lib/appointments/calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/appointments/calendar
//   ?site_code=GAB-MAIN&service_code=HIV-TEST&year=2026&month=3   -> month summary
//   &day=2026-03-14                                              -> also returns that day's slots
//
// Read-only public availability. No personal data, no client_id, no auth needed.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const siteCode = sp.get('site_code') ?? '';
  const serviceCode = sp.get('service_code') ?? '';
  const year = Number(sp.get('year'));
  const month = Number(sp.get('month'));
  const day = sp.get('day');

  if (!siteCode || !serviceCode || !Number.isFinite(year) || !Number.isFinite(month)) {
    return json({ error: 'site_code, service_code, year, month are required' }, 400);
  }
  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return json({ error: 'year/month out of range' }, 400);
  }

  const summary = await getMonthSummary(siteCode, serviceCode, year, month);
  const slots = day ? await getDaySlots(siteCode, serviceCode, day) : null;

  return json({ ...summary, slots });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

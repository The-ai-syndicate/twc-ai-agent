import { NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/appointments/sites
//   -> { sites: [{ code, name, town, phone, services:[{code,name}] }, ...] }
//
// Public list of TWC centres and the services each one offers, used by the
// in-chat appointment calendar so the client can pick a centre first.
export async function GET(_req: NextRequest) {
  const db = serviceClient();

  const [{ data: sites }, { data: services }, { data: links }] = await Promise.all([
    db.from('sites').select('id,code,name,town,phone').order('name'),
    db.from('services').select('id,code,name').order('name'),
    db.from('site_services').select('site_id,service_id'),
  ]);

  type SiteRow = { id: string; code: string; name: string; town: string | null; phone: string | null };
  type ServiceRow = { id: string; code: string; name: string };
  type LinkRow = { site_id: string; service_id: string };

  const svcById = new Map<string, ServiceRow>();
  for (const s of (services ?? []) as ServiceRow[]) svcById.set(s.id, s);

  const bySite = new Map<string, { code: string; name: string }[]>();
  for (const l of (links ?? []) as LinkRow[]) {
    const svc = svcById.get(l.service_id);
    if (!svc) continue;
    const list = bySite.get(l.site_id) ?? [];
    list.push({ code: svc.code, name: svc.name });
    bySite.set(l.site_id, list);
  }

  const out = ((sites ?? []) as SiteRow[]).map((s) => ({
    code: s.code,
    name: s.name,
    town: s.town,
    phone: s.phone,
    services: (bySite.get(s.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));

  return json({ sites: out });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

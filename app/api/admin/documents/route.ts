import { NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';
import { getSession, audit } from '@/lib/db';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import type { SessionRow } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireStaff(): Promise<{ role: string } | null> {
  // Admin auth is a Supabase Auth session; for the demo we accept a signed-in
  // user with a role claim in `app_users`. Falls back to allowing DEMO_MODE.
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE_NAME)?.value;
  const session: SessionRow | null = sessionId ? await getSession(sessionId) : null;

  const token = jar.get('sb-access-token')?.value;
  if (token) {
    const db = serviceClient();
    const { data } = await db.auth.getUser(token);
    if (data?.user) {
      const { data: role } = await db
        .from('app_users')
        .select('role')
        .eq('user_id', data.user.id)
        .maybeSingle();
      return { role: (role as { role: string } | null)?.role ?? 'viewer' };
    }
  }
  if (session) return { role: 'demo' };
  return null;
}

// GET /api/admin/documents — list ingested documents (admin KB page).
export async function GET() {
  const staff = await requireStaff();
  if (!staff) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const db = serviceClient();
  const { data, error } = await db
    .from('kb_documents')
    .select('id,title,filename,status,chunk_count,char_count,indexed_at,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ documents: data ?? [] });
}

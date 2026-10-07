import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { serviceClient } from '@/lib/supabase/server';
import { getSession, isVerified, audit } from '@/lib/db';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { sendEmail, isValidEmail } from '@/lib/email/send';
import { appointmentEmail } from '@/lib/appointments/email-template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/appointments/book
// Body: { site_code, service_code, starts_at (ISO) | slot_id, email?, notes? }
// Books for the session's client. Returns { ok, reference, startsAt, ... }.
// When an email is supplied we store it on the appointment and send the
// confirmation (reference + details) so the client has their unique id.
export async function POST(req: NextRequest) {
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return json({ ok: false, error: 'Your session expired. Please reload the page.' }, 401);

  const session = await getSession(sessionId);
  if (!session) return json({ ok: false, error: 'Your session expired. Please reload the page.' }, 401);

  const body = (await req.json().catch(() => ({}))) as {
    site_code?: string;
    service_code?: string;
    starts_at?: string;
    slot_id?: string;
    email?: string;
    notes?: string;
  };
  const siteCode = (body.site_code ?? '').toString();
  const serviceCode = (body.service_code ?? '').toString();
  const startsAt = (body.starts_at ?? '').toString();
  const notes = body.notes ? String(body.notes).slice(0, 300) : null;
  const email = (body.email ?? '').toString().trim().toLowerCase();

  if (!isValidEmail(email)) {
    return json(
      {
        ok: false,
        needsEmail: true,
        error: "I'd love to send your confirmation — please share your email address.",
      },
      400,
    );
  }

  // Verification: personal-data booking needs a verified client. In DEMO_MODE we
  // link the lightweight demo client so the in-chat flow works end to end.
  let clientId = session.client_id;
  if (!isVerified(session) || !clientId) {
    if (config.demoMode) {
      const { linkDemoClientForSession } = await import('@/lib/auth/demo');
      clientId = await linkDemoClientForSession(sessionId);
    }
    if (!clientId) {
      return json(
        { ok: false, needsVerification: true, error: 'Please verify your phone number to book.' },
        403,
      );
    }
  }

  const db = serviceClient();

  try {
    let data: unknown;

    if (body.slot_id) {
      const res = await db.rpc('book_slot', {
        p_slot_id: body.slot_id,
        p_client_id: clientId,
        p_notes: notes,
        p_channel: 'web',
      });
      if (res.error) throw new Error(res.error.message);
      data = res.data;
    } else {
      if (!siteCode || !serviceCode || !startsAt) {
        return json({ ok: false, error: 'site_code, service_code and starts_at are required.' }, 400);
      }
      const { data: site } = await db.from('sites').select('id').eq('code', siteCode).maybeSingle();
      const { data: service } = await db.from('services').select('id').eq('code', serviceCode).maybeSingle();
      const siteId = (site as { id: string } | null)?.id;
      const serviceId = (service as { id: string } | null)?.id;
      if (!siteId || !serviceId) return json({ ok: false, error: 'Unknown centre or service.' }, 404);

      const res = await db.rpc('book_appointment_at', {
        p_site_id: siteId,
        p_service_id: serviceId,
        p_starts_at: startsAt,
        p_client_id: clientId,
        p_notes: notes,
        p_channel: 'web',
      });
      if (res.error) throw new Error(res.error.message);
      data = res.data;
    }

    const appt = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const reference = String(appt?.reference ?? '');
    const confirmedStart = String(appt?.starts_at ?? startsAt);

    // Store the email + fetch names for the confirmation.
    let details: Record<string, unknown> | null = null;
    try {
      await db.rpc('set_appointment_email', { p_reference: reference, p_email: email });
      const { data: det } = await db.rpc('appointments_details', { p_reference: reference });
      details = (Array.isArray(det) ? det[0] : det) as Record<string, unknown> | null;
    } catch {
      /* non-fatal: booking already succeeded */
    }

    // Send the confirmation email (reference + details). Never let a mail error
    // fail the booking.
    let emailSent = false;
    try {
      const tpl = appointmentEmail({
        reference,
        startsAt: confirmedStart,
        siteName: str(details?.site_name) ?? undefined,
        siteTown: str(details?.site_town) ?? undefined,
        sitePhone: str(details?.site_phone) ?? undefined,
        serviceName: str(details?.service_name) ?? undefined,
      });
      const res = await sendEmail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html });
      emailSent = res.ok;
    } catch {
      emailSent = false;
    }

    await audit('booking.created', {
      clientId,
      entity: 'appointment',
      entityId: reference,
      meta: { source: 'in_chat_calendar', site: siteCode, service: serviceCode, emailSent },
    });

    return json({
      ok: true,
      reference,
      startsAt: confirmedStart,
      status: appt?.status ?? 'booked',
      emailSent,
      email,
      details: details ?? undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    const friendly =
      msg.includes('SLOT_FULL')
        ? 'That time was just taken. Please choose another.'
        : msg.includes('SLOT_IN_PAST')
          ? 'That time has already passed. Please choose a later one.'
          : 'I could not complete the booking just now. Please try another time.';
    return json({ ok: false, error: friendly }, 409);
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

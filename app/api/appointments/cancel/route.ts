import { NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase/server';
import { audit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/appointments/cancel
// Body: { reference, confirm?: boolean }
//   - Without confirm: looks the appointment up by its unique id (reference) and
//     returns its details so the client can check it is the right one.
//   - With confirm: true: cancels it (frees the slot, cancels reminders).
//
// The reference is the client's own "unique appointment id" (e.g. TWC-A-10231).
// This casual cancel path works from the chat without a phone check, mirroring
// cancel_appointment_by_reference. It only ever acts on an id the client quotes.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    reference?: string;
    confirm?: boolean;
  };
  const reference = (body.reference ?? '').toString().trim().toUpperCase();
  if (!reference) {
    return json({ ok: false, error: 'Please enter your appointment ID.' }, 400);
  }

  const db = serviceClient();

  try {
    // Always look up first so we can show/confirm the right appointment.
    const { data: det, error: detErr } = await db.rpc('appointments_details', {
      p_reference: reference,
    });
    if (detErr) throw new Error(detErr.message);
    const details = (Array.isArray(det) ? det[0] : det) as Record<string, unknown> | null;
    if (!details) {
      return json({ ok: false, notFound: true, error: 'I could not find that appointment ID.' }, 404);
    }
    if (String(details.status ?? '') === 'cancelled') {
      return json({ ok: false, alreadyCancelled: true, details, error: 'That appointment is already cancelled.' }, 409);
    }

    if (!body.confirm) {
      // Preview only — hand the client the details to confirm.
      await audit('booking.cancel.preview', {
        entity: 'appointment',
        entityId: reference,
        meta: { source: 'in_chat_calendar' },
      });
      return json({ ok: true, confirmed: false, details });
    }

    const { data, error } = await db.rpc('cancel_appointment_by_reference', {
      p_reference: reference,
    });
    if (error) throw new Error(error.message);
    const cancelled = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

    await audit('booking.cancelled', {
      entity: 'appointment',
      entityId: reference,
      meta: { source: 'in_chat_calendar' },
    });

    return json({ ok: true, confirmed: true, details: { ...details, status: 'cancelled' }, cancelled });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    const friendly = msg.includes('NOT_FOUND')
      ? 'I could not find that appointment ID.'
      : msg.includes('ALREADY_CANCELLED')
        ? 'That appointment is already cancelled.'
        : 'I could not cancel that appointment just now. Please try again.';
    return json({ ok: false, error: friendly }, 409);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

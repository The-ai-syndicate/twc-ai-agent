import { serviceClient } from '@/lib/supabase/server';
import { audit, isVerified, type SessionRow } from '@/lib/db';
import { SCHEMAS, type ToolName } from '@/lib/tools/schemas';
import { VERIFIED_TOOLS } from '@/lib/llm/tools';
import { retrieve as searchKnowledge } from '@/lib/pinecone/kb';
import { maskPhone } from '@/lib/privacy/redact';
import { config } from '@/lib/config';
import type { ToolResult, ToolUi, EscalationPriority } from '@/lib/types';

export type ExecContext = {
  session: SessionRow;
  // The conversation this turn belongs to (for escalations/documents).
  conversationId: string;
  ipHash?: string | null;
};

const ok = (data: unknown, ui?: ToolUi): ToolResult => ({ ok: true, data, ui });
const fail = (error: string): ToolResult => ({ ok: false, error });
const ASK_VERIFY = 'This needs a quick phone check first. May I send you a code?';

function requireVerified(ctx: ExecContext): string | null {
  return isVerified(ctx.session) ? null : ASK_VERIFY;
}

// Resolve a site/service code to its uuid. Codes are the model-facing handle;
// ids are never shown to the model.
async function siteIdByCode(code: string): Promise<string | null> {
  const db = serviceClient();
  const { data } = await db.from('sites').select('id').eq('code', code).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
async function serviceIdByCode(code: string): Promise<string | null> {
  const db = serviceClient();
  const { data } = await db.from('services').select('id').eq('code', code).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

let _sitesCache: { at: number; data: Record<string, unknown>[] } | null = null;

export async function executeTool(name: string, rawArgs: unknown, ctx: ExecContext): Promise<ToolResult> {
  const schema = SCHEMAS[name as ToolName];
  if (!schema) return fail(`Unknown tool: ${name}`);

  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return fail('Invalid arguments: ' + parsed.error.issues.map((i) => i.path.join('.')).join(', '));
  }
  const args = parsed.data as Record<string, unknown>;

  // Tool-level authorization. Never trust the model.
  if (VERIFIED_TOOLS.has(name)) {
    const denied = requireVerified(ctx);
    if (denied) {
      await audit('tool.denied_unverified', { meta: { tool: name } });
      return fail(denied);
    }
  }

  const db = serviceClient();
  const clientId = ctx.session.client_id;

  try {
    switch (name as ToolName) {
      case 'search_knowledge': {
        const a = args as { query: string; audience?: string };
        const hits = await searchKnowledge(a.query, { audience: a.audience });
        const ui: ToolUi = { kind: 'sources', sources: hits.map((h) => ({ id: h.id, title: h.title })) };
        return ok(
          hits.map((h) => ({ id: h.id, title: h.title, text: h.text, category: h.category })),
          hits.length ? ui : { kind: 'none' },
        );
      }

      case 'find_sites': {
        const a = args as { town?: string; service_code?: string };
        if (!_sitesCache || Date.now() - _sitesCache.at > 5 * 60_000) {
          const { data } = await db.from('sites').select('code,name,town,phone,hours,address').order('name');
          _sitesCache = { at: Date.now(), data: (data as Record<string, unknown>[]) ?? [] };
        }
        let rows = _sitesCache.data;
        if (a.town) {
          const town = a.town.toLowerCase();
          rows = rows.filter((r) => String(r.town ?? '').toLowerCase().includes(town));
        }
        if (a.service_code) {
          const svcId = await serviceIdByCode(a.service_code);
          const { data: ss } = await db.from('site_services').select('site_id').eq('service_id', svcId ?? '');
          const ids = new Set(((ss as { site_id: string }[] | null) ?? []).map((r) => r.site_id));
          const { data: sites } = await db.from('sites').select('id,code').in('id', ids.size ? [...ids] : ['__none__']);
          const okCodes = new Set(((sites as { code: string }[] | null) ?? []).map((r) => r.code));
          rows = rows.filter((r) => okCodes.has(String(r.code)));
        }
        return ok(rows);
      }

      case 'list_services': {
        const a = args as { site_code?: string };
        if (a.site_code) {
          const sid = await siteIdByCode(a.site_code);
          const { data: ss } = await db.from('site_services').select('service_id').eq('site_id', sid ?? '');
          const ids = ((ss as { service_id: string }[] | null) ?? []).map((r) => r.service_id);
          const { data } = await db
            .from('services')
            .select('code,name,neutral_label,description')
            .in('id', ids.length ? ids : ['__none__'])
            .order('name');
          return ok(data ?? []);
        }
        const { data } = await db.from('services').select('code,name,neutral_label,description').order('name');
        return ok(data ?? []);
      }

      case 'get_available_slots': {
        const a = args as {
          site_code: string;
          service_code: string;
          date_from?: string;
          date_to?: string;
          part_of_day?: string;
        };
        const sid = await siteIdByCode(a.site_code);
        const svcId = await serviceIdByCode(a.service_code);
        if (!sid || !svcId) return ok([]);
        let q = db
          .from('availability_slots')
          .select('id,starts_at,ends_at,capacity,booked')
          .eq('site_id', sid)
          .eq('service_id', svcId)
          .gte('starts_at', a.date_from ?? new Date().toISOString())
          .order('starts_at')
          .limit(24);
        if (a.date_to) q = q.lte('starts_at', a.date_to);
        const { data } = await q;
        let rows = ((data as Record<string, unknown>[] | null) ?? []).filter(
          (r) => Number(r.booked) < Number(r.capacity),
        );
        if (a.part_of_day && a.part_of_day !== 'any') {
          rows = rows.filter((r) => {
            const h = new Date(String(r.starts_at)).getUTCHours() + 2; // Africa/Gaborone
            return a.part_of_day === 'morning' ? h < 12 : h >= 12;
          });
        }
        return ok(rows);
      }

      case 'get_outreach_events': {
        const a = args as { town?: string; from?: string; to?: string };
        let q = db
          .from('outreach_events')
          .select('title,town,venue,starts_at,ends_at,service_codes,notes')
          .gte('starts_at', a.from ?? new Date().toISOString())
          .order('starts_at')
          .limit(20);
        if (a.town) q = q.ilike('town', `%${a.town}%`);
        if (a.to) q = q.lte('starts_at', a.to);
        const { data } = await q;
        return ok(data ?? []);
      }

      case 'get_notices': {
        const a = args as { site_code?: string };
        let q = db.from('notices').select('title,body,starts_at,ends_at,site_id').order('starts_at', { ascending: false }).limit(20);
        if (a.site_code) {
          const sid = await siteIdByCode(a.site_code);
          q = q.or(`site_id.eq.${sid ?? '00000000-0000-0000-0000-000000000000'},site_id.is.null`);
        }
        const { data } = await q;
        return ok(data ?? []);
      }

      case 'start_verification': {
        const a = args as { phone: string };
        const { requestOtp } = await import('@/lib/auth/otp');
        const res = await requestOtp(a.phone, ctx.session, ctx.ipHash ?? null);
        if (!res.ok) return fail(res.error ?? 'Could not send a code.');
        return ok(
          { sent: true, demo: config.demoMode, phone_masked: maskPhone(a.phone) },
          { kind: 'verification', phoneMasked: maskPhone(a.phone), sent: true },
        );
      }

      case 'confirm_verification': {
        const a = args as { code: string };
        const { confirmOtp } = await import('@/lib/auth/otp');
        const res = await confirmOtp(a.code, ctx.session, ctx.conversationId);
        if (!res.ok) return fail(res.error ?? 'That code did not match.');
        return ok({ verified: true });
      }

      case 'get_my_appointments': {
        const a = args as { status?: string };
        // Join to get service/site names for a friendly reply.
        let q = db
          .from('appointments')
          .select('reference,status,starts_at,notes,site:site_id(code,name),service:service_id(code,name)')
          .eq('client_id', clientId)
          .order('starts_at', { ascending: false })
          .limit(20);
        const nowIso = new Date().toISOString();
        if (a.status === 'upcoming') q = q.gte('starts_at', nowIso).in('status', ['booked', 'confirmed', 'rescheduled']);
        else if (a.status === 'past') q = q.lt('starts_at', nowIso);
        else if (a.status === 'cancelled') q = q.eq('status', 'cancelled');
        const { data, error } = await q;
        if (error) return fail('Could not load your appointments just now.');
        await audit('data.view.appointments', { clientId });
        return ok(data ?? []);
      }

      case 'show_appointment_calendar': {
        const a = args as { site_code?: string; service_code?: string; mode?: string };
        const mode = a.mode === 'book' || a.mode === 'cancel' || a.mode === 'manage' ? a.mode : 'manage';
        let siteName: string | undefined;
        let serviceName: string | undefined;
        if (a.site_code) {
          const { data } = await db.from('sites').select('name').eq('code', a.site_code).maybeSingle();
          siteName = (data as { name: string } | null)?.name ?? undefined;
        }
        if (a.service_code) {
          const { data } = await db.from('services').select('name').eq('code', a.service_code).maybeSingle();
          serviceName = (data as { name: string } | null)?.name ?? undefined;
        }
        return ok(
          {
            opened: true,
            site_code: a.site_code ?? null,
            service_code: a.service_code ?? null,
            site_name: siteName ?? null,
            service_name: serviceName ?? null,
            mode,
            note:
              'Calendar shown to the client. When no centre was given, they pick a centre first. ' +
              'Booking requires phone verification; cancel accepts a unique appointment id.',
          },
          {
            kind: 'calendar',
            siteCode: a.site_code ?? '',
            serviceCode: a.service_code ?? '',
            siteName,
            serviceName,
            mode,
          },
        );
      }

      case 'book_appointment': {
        const a = args as { slot_id: string; notes?: string };
        const { data, error } = await db.rpc('book_slot', {
          p_slot_id: a.slot_id,
          p_client_id: clientId,
          p_notes: a.notes ?? null,
          p_channel: 'web',
        });
        if (error) return fail(error.message);
        const appt = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
        await audit('booking.created', { clientId, entity: 'appointment', entityId: String(appt?.id ?? ''), meta: { slot: a.slot_id } });
        const ref = String(appt?.reference ?? '');
        return ok(appt, { kind: 'booking', reference: ref, summary: ref });
      }

      case 'reschedule_appointment': {
        const a = args as { reference: string; new_slot_id: string };
        const { data, error } = await db.rpc('reschedule_appointment', {
          p_reference: a.reference,
          p_new_slot_id: a.new_slot_id,
          p_client_id: clientId,
        });
        if (error) return fail(error.message);
        await audit('booking.rescheduled', { clientId, entity: 'appointment', entityId: a.reference });
        return ok(Array.isArray(data) ? data[0] : data);
      }

      case 'cancel_appointment': {
        const a = args as { reference: string };
        const { data, error } = await db.rpc('cancel_appointment', {
          p_reference: a.reference,
          p_client_id: clientId,
        });
        if (error) return fail(error.message);
        await audit('booking.cancelled', { clientId, entity: 'appointment', entityId: a.reference });
        return ok(Array.isArray(data) ? data[0] : data);
      }

      case 'get_my_referrals': {
        const { data, error } = await db
          .from('referrals')
          .select('reference,to_facility,to_service,status,issued_at,due_by,what_to_bring')
          .eq('client_id', clientId)
          .order('issued_at', { ascending: false })
          .limit(20);
        if (error) return fail('Could not load your referrals just now.');
        await audit('data.view.referrals', { clientId });
        return ok(data ?? []);
      }

      case 'update_preferences': {
        const a = args as {
          language?: string;
          discreet_mode?: boolean;
          consent_messaging?: boolean;
          preferred_site?: string;
        };
        const patch: Record<string, unknown> = {};
        if (a.language) patch.preferred_language = a.language;
        if (typeof a.discreet_mode === 'boolean') patch.discreet_mode = a.discreet_mode;
        if (typeof a.consent_messaging === 'boolean') {
          patch.consent_messaging = a.consent_messaging;
          patch.consent_at = new Date().toISOString();
        }
        if (a.preferred_site) {
          const sid = await siteIdByCode(a.preferred_site);
          if (sid) patch.preferred_site_id = sid;
        }
        if (Object.keys(patch).length) await db.from('clients').update(patch).eq('id', clientId);
        if (a.language) await db.from('chat_sessions').update({ language: a.language }).eq('id', ctx.session.id);
        if (a.consent_messaging !== undefined) {
          await db.from('consent_records').insert({
            client_id: clientId,
            kind: 'messaging',
            wording_version: 'v1',
            granted: a.consent_messaging,
          });
        }
        return ok({ updated: true });
      }

      case 'request_data_access_or_deletion': {
        const a = args as { type: 'access' | 'deletion' };
        const { data } = await db
          .from('escalations')
          .insert({
            conversation_id: ctx.conversationId,
            priority: 'normal',
            reason: `Data ${a.type} request`,
            summary: `Client requested data ${a.type}.`,
            status: 'open',
          })
          .select('id')
          .single();
        await audit('data.request.' + a.type, { clientId });
        return ok({ recorded: true, escalation_id: data?.id ?? null });
      }

      case 'process_document': {
        const a = args as { document_id: string };
        const { processDocument } = await import('@/lib/ocr/process');
        const res = await processDocument(a.document_id, clientId!);
        if (!res.ok) return fail(res.error ?? "I couldn't read this clearly, can you retake the photo?");
        return ok(res.data, { kind: 'document', documentId: a.document_id, fields: res.fields ?? {} });
      }

      case 'escalate_to_human': {
        const a = args as { reason: string; priority: EscalationPriority; summary: string };
        const { data } = await db
          .from('escalations')
          .insert({
            conversation_id: ctx.conversationId,
            priority: a.priority,
            reason: a.reason,
            summary: a.summary,
            status: 'open',
          })
          .select('id')
          .single();
        await db.from('conversations').update({ status: 'escalated' }).eq('id', ctx.conversationId);
        await audit('escalation.created', { clientId, meta: { priority: a.priority } });
        return ok({ created: true, id: data?.id, priority: a.priority });
      }

      case 'log_feedback': {
        const a = args as { text: string; anonymous?: boolean };
        await db.from('feedback').insert({
          conversation_id: ctx.conversationId,
          rating: 1,
          text: a.text,
          anonymous: !!a.anonymous,
        });
        return ok({ recorded: true });
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (e) {
    console.error('[tool]', name, e instanceof Error ? e.message : 'error');
    return fail('I could not complete that request just now.');
  }
}

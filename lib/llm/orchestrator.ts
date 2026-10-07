import { runTurn, type TurnMessage } from '@/lib/llm/client';
import { systemPromptFor } from '@/lib/llm/system-prompt';
import { precheckSafety, detectInjection } from '@/lib/safety/precheck';
import { appendMessage, recentMessages, isVerified, touchSession, audit, getSession } from '@/lib/db';
import type { ExecContext } from '@/lib/tools/executor';
import { redact } from '@/lib/privacy/redact';
import { config } from '@/lib/config';
import type { StreamEvent, ToolUi } from '@/lib/types';

// Conversation Service. Wraps one user turn:
//  1. safety pre-check (BEFORE the LLM)
//  2. load capped history
//  3. run the LLM with tools (client_id comes from the SESSION, never the model)
//  4. stream tokens + UI side-channel
//  5. persist messages with PII redaction

export type ChatInput = {
  sessionId: string;
  conversationId: string;
  userText: string;
  ipHash?: string | null;
};

export async function* runChatTurn(input: ChatInput): AsyncGenerator<StreamEvent> {
  const text = input.userText.trim().slice(0, config.limits.maxMessageChars);
  if (!text) {
    yield { type: 'error', message: 'Please type a message.' };
    return;
  }

  const session = await getSession(input.sessionId);
  if (!session) {
    yield { type: 'error', message: 'Your session expired. Please reload the page.' };
    return;
  }
  await touchSession(session.id);

  // Persist the user message (redacted copy stored; raw never logged).
  await appendMessage(input.conversationId, 'user', text, { redactedText: redact(text) });

  // --- Safety pre-check (runs before the model) ---------------------------------
  const hit = precheckSafety(text);
  if (hit) {
    await audit('safety.precheck', { clientId: session.client_id, meta: { category: hit.category } });
    yield* handleSafety(hit, input, session);
    return;
  }

  if (detectInjection(text)) {
    // Neutralise: we still answer normally, but log the attempt. The system
    // prompt and tool-level authorization are the real defence.
    await audit('safety.injection_suspected', { clientId: session.client_id });
  }

  const history = (await recentMessages(input.conversationId, 20)).slice(-16).map<TurnMessage>((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  const firstName = session.client_id ? await firstNameOf(session.client_id) : null;
  const system = await systemPromptFor({
    language: session.language ?? 'en',
    verified: isVerified(session),
    firstName,
  });

  const ctx: ExecContext = {
    session,
    conversationId: input.conversationId,
    ipHash: input.ipHash ?? null,
  };

  const uiQueue: ToolUi[] = [];
  let full = '';

  try {
    const result = await runTurn({
      system,
      history,
      userMessage: text,
      ctx,
      onToken: () => {},
      onUi: (u) => uiQueue.push(u),
      signal: undefined,
    });
    full = result.text;

    // Stream the final text token-ish (chunked) after the tool loop completes.
    for (const piece of chunkForStream(full)) {
      yield { type: 'token', value: piece };
    }
    for (const u of result.ui) {
      if (u.kind === 'escalation') {
        yield { type: 'escalation', id: u.id, priority: u.priority, message: '' };
      }
      yield { type: 'ui', value: u };
    }

    // Auto-escalation if an escalation tool ran.
    const esc = result.ui.find((u) => u.kind === 'escalation');
    if (esc && esc.kind === 'escalation') {
      await audit('escalation.raised_by_model', { clientId: session.client_id, meta: { priority: esc.priority } });
    }

    // Persist the assistant reply (redacted).
    const msgId = await appendMessage(input.conversationId, 'assistant', full || '(no reply)', {
      redactedText: redact(full || ''),
      sources: result.ui.find((u) => u.kind === 'sources') ?? null,
    });
    await audit('message.assistant', { clientId: session.client_id, meta: { tools: result.toolCalls.map((t) => t.name) } });
    yield { type: 'done', messageId: msgId ?? '' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    console.error('[chat]', redact(msg));
    yield { type: 'error', message: 'Something went wrong on my side. Please try again.' };
  }
}

// --- Safety handling ----------------------------------------------------------
async function* handleSafety(
  hit: { category: string; priority: string; label: string },
  input: ChatInput,
  session: { id: string; client_id: string | null },
): AsyncGenerator<StreamEvent> {
  const { serviceClient } = await import('@/lib/supabase/server');
  const db = serviceClient();

  const emergency =
    'Emergency numbers: Ambulance 997, Police 999. Tebelopele can also help — a team member will join this chat shortly.';

  const reply =
    'I am here with you. This sounds urgent, so please also contact emergency services now: ' +
    'Ambulance 997, Police 999. I am asking a TWC team member to join this chat straight away. ' +
    'You can keep talking to me while you wait.';

  // Create a high/critical escalation with a NON-SENSITIVE summary.
  const { data: esc } = await db
    .from('escalations')
    .insert({
      conversation_id: input.conversationId,
      priority: hit.priority === 'critical' ? 'critical' : 'high',
      reason: hit.label,
      summary: `Safety pre-check matched: ${hit.category}. No clinical detail recorded.`,
      status: 'open',
    })
    .select('id')
    .single();

  await db.from('conversations').update({ status: 'escalated' }).eq('id', input.conversationId);
  await audit('escalation.created', { clientId: session.client_id, meta: { source: 'precheck', category: hit.category } });

  for (const piece of chunkForStream(reply + ' ' + emergency)) {
    yield { type: 'token', value: piece };
  }
  yield { type: 'safety', category: hit.category, message: emergency };
  if (esc) yield { type: 'escalation', id: (esc as { id: string }).id, priority: 'critical', message: reply };

  await appendMessage(input.conversationId, 'assistant', reply, { redactedText: redact(reply) });
  yield { type: 'done', messageId: '' };
}

async function firstNameOf(clientId: string): Promise<string | null> {
  const { serviceClient } = await import('@/lib/supabase/server');
  const { data } = await serviceClient().from('clients').select('first_name').eq('id', clientId).maybeSingle();
  return (data as { first_name: string | null } | null)?.first_name ?? null;
}

// Split text into small pieces for a smooth streamed effect on slow links.
function chunkForStream(text: string): string[] {
  if (!text) return [];
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  let buf = '';
  for (const w of words) {
    buf += w;
    if (buf.length >= 12) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

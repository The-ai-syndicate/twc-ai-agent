import OpenAI from 'openai';
import { config } from '@/lib/config';
import { LLM_TOOLS } from '@/lib/llm/tools';
import type { ExecContext } from '@/lib/tools/executor';
import { executeTool } from '@/lib/tools/executor';
import type { ToolUi } from '@/lib/types';

// DeepSeek client (OpenAI-compatible). Server-side only — the API key never
// reaches the browser. We run a bounded tool-use loop, then stream the final
// answer token-by-token.

function client(): OpenAI {
  if (!config.llm.apiKey) throw new Error('LLM API key is not configured');
  return new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl });
}

export type TurnMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export type OnToken = (delta: string) => void;
export type OnUi = (ui: ToolUi) => void;

export type RunResult = {
  text: string;
  ui: ToolUi[];
  toolCalls: { name: string; args: unknown; ok: boolean }[];
  usage: { prompt: number; completion: number };
};

const MAX_HISTORY = 16; // cap conversation length sent to the model (cost control)

export async function runTurn(opts: {
  system: string;
  history: TurnMessage[];
  userMessage: string;
  ctx: ExecContext;
  onToken: OnToken;
  onUi: OnUi;
  signal?: AbortSignal;
}): Promise<RunResult> {
  const openai = client();
  const ui: ToolUi[] = [];
  const toolCalls: RunResult['toolCalls'] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  const messages: TurnMessage[] = [
    { role: 'system', content: opts.system },
    ...opts.history.slice(-MAX_HISTORY),
    { role: 'user', content: opts.userMessage },
  ];

  for (let round = 0; round <= config.llm.maxToolRounds; round++) {
    const isLastRound = round === config.llm.maxToolRounds;
    const stream = await openai.chat.completions.create(
      {
        model: config.llm.model,
        messages,
        tools: isLastRound ? undefined : LLM_TOOLS,
        tool_choice: isLastRound ? undefined : 'auto',
        temperature: config.llm.temperature,
        max_tokens: config.llm.maxTokensPerMessage,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: opts.signal },
    );

    let text = '';
    const pending: { id: string; name: string; args: string }[] = [];
    let finish: string | null = null;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) {
        text += delta.content;
        // Buffer only. The orchestrator streams the FINAL answer after all tool
        // rounds, so we must not emit intermediate reasoning text to the user.
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!pending[idx]) pending[idx] = { id: tc.id ?? '', name: '', args: '' };
          if (tc.id) pending[idx].id = tc.id;
          if (tc.function?.name) pending[idx].name += tc.function.name;
          if (tc.function?.arguments) pending[idx].args += tc.function.arguments;
        }
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (chunk.usage) {
        promptTokens += chunk.usage.prompt_tokens ?? 0;
        completionTokens += chunk.usage.completion_tokens ?? 0;
      }
    }

    if (finish === 'tool_calls' && pending.length) {
      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: pending.map((p) => ({
          id: p.id,
          type: 'function' as const,
          function: { name: p.name, arguments: p.args || '{}' },
        })),
      });

      for (const call of pending) {
        let parsedArgs: unknown = {};
        try {
          parsedArgs = call.args ? JSON.parse(call.args) : {};
        } catch {
          parsedArgs = {};
        }
        const result = await executeTool(call.name, parsedArgs, opts.ctx);
        toolCalls.push({ name: call.name, args: parsedArgs, ok: result.ok });
        if (result.ui) {
          ui.push(result.ui);
          opts.onUi(result.ui);
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result.ok ? result.data : { error: result.error }),
        });
      }
      continue; // let the model use the tool results
    }

    return { text, ui, toolCalls, usage: { prompt: promptTokens, completion: completionTokens } };
  }

  return { text: '', ui, toolCalls, usage: { prompt: promptTokens, completion: completionTokens } };
}

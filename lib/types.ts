// Shared domain + wire types.

export type Language = 'en' | 'tn';

export type SessionState = {
  sessionId: string;
  conversationId: string;
  verified: boolean;
  verifiedUntil: string | null;
  clientId: string | null;
  language: Language;
  discreetMode: boolean;
  preferredSite: string | null;
};

export type EscalationPriority = 'low' | 'normal' | 'high' | 'critical';

export type ToolResult = {
  ok: boolean;
  // Data returned to the model. Must never contain another client's data.
  data?: unknown;
  error?: string;
  // UI-only side-channel (e.g. source chips, escalation banner). Never sent to LLM.
  ui?: ToolUi;
};

export type ToolUi =
  | { kind: 'sources'; sources: { id: string; title: string }[] }
  | { kind: 'escalation'; id: string; priority: EscalationPriority }
  | { kind: 'booking'; reference: string; summary: string }
  | { kind: 'verification'; phoneMasked: string; sent: boolean }
  | { kind: 'document'; documentId: string; fields: Record<string, string | string[] | undefined> }
  | { kind: 'calendar'; siteCode: string; serviceCode: string; siteName?: string; serviceName?: string; mode?: 'book' | 'cancel' | 'manage' }
  | { kind: 'none' };

// A chat message as streamed to the browser via SSE.
export type StreamEvent =
  | { type: 'token'; value: string }
  | { type: 'ui'; value: ToolUi }
  | { type: 'escalation'; id: string; priority: EscalationPriority; message: string }
  | { type: 'safety'; category: string; message: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };

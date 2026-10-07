"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Language, StreamEvent, ToolUi } from "@/lib/types";

export type SourceChip = { id: string; title: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: SourceChip[];
  documentFields?: Record<string, string | string[] | undefined>;
  calendar?: CalendarRequest;
  safety?: boolean;
  streaming?: boolean;
  error?: boolean;
};

export type CalendarMode = 'book' | 'cancel' | 'manage';

export type CalendarRequest = {
  siteCode: string;
  serviceCode: string;
  siteName?: string;
  serviceName?: string;
  mode?: CalendarMode;
};

export type Booking = { reference: string; startsAt: string };

export type Escalation = { id: string; priority: string; message: string };

type UseChat = {
  messages: ChatMessage[];
  sending: boolean;
  escalation: Escalation | null;
  send: (text: string, language: Language) => Promise<void>;
  /** Open the appointment calendar directly in the chat, no model round-trip. */
  openCalendar: (opts: { prompt: string; siteCode?: string; serviceCode?: string; mode?: "book" | "cancel" | "manage" }) => void;
  reset: () => void;
};

// Default centre + service used when the client taps "Book, change or cancel an
// appointment" without naming one yet: TWC Gaborone, HIV testing & counselling.
const DEFAULT_SITE_CODE = "GBE";
const DEFAULT_SERVICE_CODE = "HTC";

const WELCOME_EN =
  "Hello, I'm the TWC Assistant. I can help you book or manage appointments, find a Tebelopele centre, or share approved health information. What would you like to do?";
const WELCOME_TN =
  "Dumela, ke Thuso ya TWC. Nka go thusa go buka kgotsa go laola dibuka, go batla lefelo la Tebelopele, kgotsa go abelana tshedimosetso e e letleletsweng ya botsogo. O batla go dira eng?";

export function welcomeFor(language: Language): string {
  return language === "tn" ? WELCOME_TN : WELCOME_EN;
}

let idc = 0;
const nextId = () => `m${Date.now()}-${idc++}`;

export function useChat(language: Language): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: nextId(), role: "assistant", content: welcomeFor(language) },
  ]);
  const [sending, setSending] = useState(false);
  const [escalation, setEscalation] = useState<Escalation | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Keep the welcome message in sync with the language toggle on an empty chat.
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].role === "assistant") {
        return [{ id: prev[0].id, role: "assistant", content: welcomeFor(language) }];
      }
      return prev;
    });
  }, [language]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setEscalation(null);
    setSending(false);
    setMessages([{ id: nextId(), role: "assistant", content: welcomeFor(language) }]);
  }, [language]);

  // Open the appointment calendar immediately, deterministically, without a
  // model round-trip. Used by the "Book, change or cancel an appointment" quick
  // action so the client always sees the calendar first.
  const openCalendar = useCallback(
    (opts: {
      prompt: string;
      siteCode?: string;
      serviceCode?: string;
      mode?: "book" | "cancel" | "manage";
    }) => {
      abortRef.current?.abort();
      abortRef.current = null;
      setEscalation(null);
      const userMsg: ChatMessage = { id: nextId(), role: "user", content: opts.prompt };
      const assistant: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content:
          opts.mode === "cancel"
            ? "Sure — to cancel, enter your unique appointment ID below and I'll find it for you."
            : "Here's the live calendar. First pick the centre that's easiest for you, then choose a day and time. You can also switch to Cancel if you'd like to cancel an existing appointment.",
        calendar: {
          // No centre pre-selected: the client must choose one first.
          siteCode: opts.siteCode ?? "",
          serviceCode: opts.serviceCode ?? "",
          mode: opts.mode ?? "manage",
        },
      };
      setMessages((prev) => [...prev, userMsg, assistant]);
    },
    [],
  );

  const send = useCallback(
    async (text: string, lang: Language) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userMsg: ChatMessage = { id: nextId(), role: "user", content: trimmed };
      const assistantId = nextId();
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      setSending(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const patchAssistant = (patch: Partial<ChatMessage>) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
        );

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: trimmed, language: lang }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: "Something went wrong." }));
          patchAssistant({ streaming: false, error: true, content: err.error ?? "Something went wrong." });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let content = "";
        const sources: SourceChip[] = [];
        let documentFields: ChatMessage["documentFields"];
        let calendar: CalendarRequest | undefined;

        const applyUi = (ui: ToolUi) => {
          if (ui.kind === "sources") {
            for (const s of ui.sources) {
              if (!sources.some((x) => x.id === s.id)) sources.push(s);
            }
          } else if (ui.kind === "document") {
            documentFields = ui.fields;
          } else if (ui.kind === "calendar") {
            calendar = {
              siteCode: ui.siteCode,
              serviceCode: ui.serviceCode,
              siteName: ui.siteName,
              serviceName: ui.serviceName,
              mode: ui.mode,
            };
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            let evt: StreamEvent;
            try {
              evt = JSON.parse(raw) as StreamEvent;
            } catch {
              continue;
            }
            switch (evt.type) {
              case "token":
                content += evt.value;
                patchAssistant({ content });
                break;
              case "ui":
                applyUi(evt.value);
                patchAssistant({ sources: [...sources], documentFields, calendar });
                break;
              case "safety":
                patchAssistant({ safety: true });
                break;
              case "escalation":
                setEscalation({ id: evt.id, priority: evt.priority, message: evt.message });
                break;
              case "error":
                content = content || evt.message;
                patchAssistant({ content, error: true });
                break;
              case "done":
                break;
            }
          }
        }

        patchAssistant({
          content: content || "(no reply)",
          sources: sources.length ? sources : undefined,
          documentFields,
          calendar,
          streaming: false,
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        patchAssistant({
          streaming: false,
          error: true,
          content: "I couldn't reach the assistant. Please check your connection and try again.",
        });
      } finally {
        setSending(false);
      }
    },
    [sending],
  );

  return { messages, sending, escalation, send, openCalendar, reset };
}

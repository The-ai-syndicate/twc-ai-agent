"use client";

import { AlertTriangle, BookOpen, FileText, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import type { ChatMessage } from "@/lib/ui/useChat";
import { AppointmentCalendar } from "@/components/chat/AppointmentCalendar";

function renderInline(text: string) {
  // Very small markdown subset: **bold** only.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-zinc-50">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSafety = message.safety;

  if (isUser) {
    return (
      <div className="flex justify-end animate-bubble-in">
        <div className="flex items-end gap-2 max-w-[85%]">
          <div className="twc-gradient rounded-3xl rounded-br-lg px-4 py-2.5 text-sm leading-relaxed text-white shadow-lg shadow-[#c93530]/30">
            {message.content}
          </div>
          <div className="mb-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-zinc-800 text-zinc-400">
            <User className="size-3.5" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start animate-bubble-in">
      <div className="flex items-start gap-2 max-w-[88%]">
        <div
          className={cn(
            "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full",
            isSafety ? "bg-red-500/20 text-red-400" : "bg-brand/15 text-brand-light",
          )}
        >
          {isSafety ? <AlertTriangle className="size-3.5" /> : <Sparkles className="size-3.5" />}
        </div>
        <div className="min-w-0 space-y-2">
          <div
            className={cn(
              "rounded-3xl rounded-bl-lg px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
              isSafety
                ? "border border-red-500/30 bg-red-500/10 text-red-100"
                : message.error
                  ? "border border-amber-500/30 bg-amber-500/10 text-amber-100"
                  : "apple-glass text-zinc-100",
            )}
          >
            {message.content
              ? renderInline(message.content)
              : message.streaming && (
                  <span className="flex items-center gap-1 py-0.5">
                    <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
                    <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
                    <span className="typing-dot size-1.5 rounded-full bg-zinc-400" />
                  </span>
                )}
          </div>

          {message.calendar && (
            <AppointmentCalendar
              siteCode={message.calendar.siteCode}
              serviceCode={message.calendar.serviceCode}
              siteName={message.calendar.siteName}
              serviceName={message.calendar.serviceName}
              mode={message.calendar.mode ?? "manage"}
            />
          )}

          {message.documentFields && Object.keys(message.documentFields).length > 0 && (
            <div className="apple-card space-y-1.5 p-3 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-zinc-300">
                <FileText className="size-3.5 text-brand-light" />
                From your document
              </div>
              {Object.entries(message.documentFields).map(([k, v]) => {
                const val = Array.isArray(v) ? v.join(", ") : v;
                if (!val) return null;
                return (
                  <div key={k} className="flex gap-2">
                    <span className="w-24 shrink-0 capitalize text-zinc-500">
                      {k.replace(/_/g, " ")}
                    </span>
                    <span className="text-zinc-200">{val}</span>
                  </div>
                );
              })}
            </div>
          )}

          {message.sources && message.sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {message.sources.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-400"
                  title={s.title}
                >
                  <BookOpen className="size-3" />
                  {s.title.length > 40 ? s.title.slice(0, 40) + "…" : s.title}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

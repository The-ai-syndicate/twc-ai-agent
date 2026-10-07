"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import { cn } from "@/lib/ui/cn";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder: string;
  listening?: boolean;
  onToggleVoice?: () => void;
  voiceSupported?: boolean;
};

export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  listening,
  onToggleVoice,
  voiceSupported,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  return (
    <div className="twc-gradient-border-glass flex items-end gap-2 rounded-[1.75rem] p-1.5">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={placeholder}
        className="max-h-[140px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder:text-white focus:outline-none"
      />

      {voiceSupported && (
        <button
          type="button"
          onClick={onToggleVoice}
          aria-label={listening ? "Stop voice input" : "Voice input"}
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full transition-colors",
            listening
              ? "bg-red-500/20 text-red-400"
              : "text-white hover:bg-white/10 hover:text-white",
          )}
        >
          {listening ? <Square className="size-4" /> : <Mic className="size-4.5" />}
        </button>
      )}

      <button
        type="button"
        onClick={onSend}
        disabled={disabled || !value.trim()}
        aria-label="Send"
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full transition-all active:scale-95",
          disabled || !value.trim()
            ? "bg-zinc-800 text-zinc-600"
            : "bg-white text-black hover:bg-zinc-200",
        )}
      >
        <ArrowUp className="size-5" />
      </button>
    </div>
  );
}

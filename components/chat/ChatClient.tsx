"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  ChevronRight,
  Headphones,
  HelpCircle,
  LifeBuoy,
  MapPin,
  Plus,
  Stethoscope,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { t, type Lang } from "@/lib/i18n/strings";
import { useChat } from "@/lib/ui/useChat";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { Composer } from "@/components/chat/Composer";

export function ChatClient() {
  const [lang, setLang] = useState<Lang>("en");
  const { messages, sending, escalation, send, openCalendar, reset } = useChat(lang);
  const [input, setInput] = useState("");
  const [autoRead, setAutoRead] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const s = useCallback((key: string) => t(key, lang), [lang]);

  // Quick-start actions surfaced under the welcome message. Each sends a
  // natural-language prompt so the assistant routes to the right tool.
  const quickActions = useMemo<
    {
      icon: React.ComponentType<{ className?: string }>;
      label: string;
      prompt: string;
      calendar?: boolean;
    }[]
  >(
    () => [
      {
        icon: CalendarClock,
        label:
          lang === "tn"
            ? "Buka, fetola kgotsa phimola appointment"
            : "Book, change or cancel an appointment",
        prompt:
          lang === "tn" ? "Ke batla go buka appointment." : "I'd like to book an appointment.",
        calendar: true,
      },
      {
        icon: MapPin,
        label:
          lang === "tn"
            ? "Batla lefelo la TWC gaufi le gago"
            : "Find a TWC centre near you, with hours and phone",
        prompt:
          lang === "tn" ? "Batla lefelo la TWC gaufi le nna." : "Help me find a TWC centre near me.",
      },
      {
        icon: Stethoscope,
        label:
          lang === "tn"
            ? "Tlhola ditirelo tse di mo lefelong"
            : "Check services offered at a centre",
        prompt:
          lang === "tn"
            ? "Ke ditirelo dife tse di mo lefelong la TWC?"
            : "What services are offered at a TWC centre?",
      },
      {
        icon: HelpCircle,
        label:
          lang === "tn"
            ? "Araba dipotso tsa botsogo ka tshedimosetso ya TWC"
            : "Answer health questions using approved TWC information",
        prompt: lang === "tn" ? "Ke na le potso ka botsogo." : "I have a health question.",
      },
      {
        icon: UserRound,
        label:
          lang === "tn"
            ? "Go golaganya le setho sa setlhopha sa TWC"
            : "Connect you to a TWC team member when you need a person",
        prompt: lang === "tn" ? "Ke batla go bua le motho." : "I'd like to speak to a person.",
      },
    ],
    [lang],
  );

  // The welcome-only state: a single assistant greeting, nothing sent yet.
  const showQuickActions = messages.length === 1 && !sending;

  const handleQuickAction = useCallback(
    (action: { prompt: string; calendar?: boolean }) => {
      if (action.calendar) {
        // Deterministically open the existing calendar (Book + Cancel) in-chat.
        openCalendar({ prompt: action.prompt, mode: "manage" });
        return;
      }
      void send(action.prompt, lang);
    },
    [lang, openCalendar, send],
  );

  const voiceSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return !!((window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, escalation]);

  // Warn once that Setswana voice is unavailable.
  useEffect(() => {
    if (lang === "tn") setVoiceNotice(s("voiceEnglishOnly"));
    else setVoiceNotice(null);
  }, [lang, s]);

  const handleSend = useCallback(() => {
    const text = input;
    setInput("");
    void send(text, lang);
  }, [input, lang, send]);

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeakingId(null);
  }, []);

  // Speak text. Prefers the server TTS proxy, but ALWAYS falls back to the
  // browser's built-in Web Speech API so "Read aloud" works even when the
  // server provider is unavailable (e.g. no cloud TTS entitlement).
  const speak = useCallback(
    async (id: string, text: string) => {
      stopSpeaking();

      const plain = text.trim();
      if (!plain) return;

      // 1) Try the server TTS proxy first.
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: plain, language: lang }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const audio = new Audio(URL.createObjectURL(blob));
          audioRef.current = audio;
          audio.onended = () => setSpeakingId(null);
          audio.onerror = () => {
            audioRef.current = null;
            speakWithBrowser(id, plain, lang);
          };
          setSpeakingId(id);
          await audio.play();
          return;
        }
        // 415 = provider explicitly can't do this language (Setswana). Still try
        // the browser voice below, but surface the note.
        if (res.status === 415) setVoiceNotice(s("voiceEnglishOnly"));
      } catch {
        /* fall through to browser speech */
      }

      // 2) Browser fallback — always available, no key, works offline.
      speakWithBrowser(id, plain, lang);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, s, stopSpeaking],
  );

  const speakWithBrowser = useCallback(
    (id: string, text: string, language: Lang) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        setSpeakingId(null);
        setVoiceNotice("Read aloud is not supported in this browser.");
        return;
      }
      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = language === "tn" ? "en-BW" : "en-GB";
      utter.rate = 0.98;
      utter.onend = () => setSpeakingId(null);
      utter.onerror = () => setSpeakingId(null);
      setSpeakingId(id);
      synth.speak(utter);
    },
    [],
  );

  const toggleVoiceInput = useCallback(() => {
    if (!voiceSupported) {
      setVoiceNotice("Voice input is not supported in this browser.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = (window as unknown as { webkitSpeechRecognition: new () => SpeechRecognition })
      .webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = lang === "tn" ? "en-BW" : "en-GB";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => (prev ? prev + " " : "") + transcript);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }, [lang, listening, voiceSupported]);

  const escalate = useCallback(async () => {
    try {
      const res = await fetch("/api/escalate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Client asked for a person" }),
      });
      if (res.ok) setInput(s("talkToPerson"));
    } catch {
      /* ignore */
    }
  }, [s]);

  // Auto-read: speak new assistant messages when enabled.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
  useEffect(() => {
    if (autoRead && lastAssistant && !lastAssistant.streaming && !lastAssistant.error) {
      // speak() toggles off if already speaking this id; guard so auto-read only fires once per message.
      if (speakingId !== lastAssistant.id) {
        void speak(lastAssistant.id, lastAssistant.content);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRead, lastAssistant?.id, lastAssistant?.streaming]);

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-2xl flex-col">
      {/* Header */}
      <header className="apple-glass-dark sticky top-0 z-20 flex items-center gap-3 rounded-b-3xl px-4 py-3">
        <div className="twc-gradient grid size-10 shrink-0 place-items-center rounded-2xl text-white shadow-lg shadow-[#c93530]/30">
          <LifeBuoy className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="twc-gradient-text truncate text-sm font-semibold">{s("appName")}</h1>
            <span className="flex items-center gap-1 text-[11px] text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse-subtle" />
              {s("statusOnline")}
            </span>
          </div>
          <p className="truncate text-[11px] text-zinc-500">{s("tagline")}</p>
        </div>

        {/* Language toggle */}
        <div className="glass-tab flex shrink-0 rounded-full p-0.5 text-[11px] font-medium">
          {(["en", "tn"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={cn(
                "rounded-full px-2.5 py-1 transition-colors",
                lang === l ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {l === "en" ? "EN" : "TN"}
            </button>
          ))}
        </div>

        <button
          onClick={reset}
          aria-label={s("newChat")}
          className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
        >
          <Plus className="size-4.5" />
        </button>
      </header>

      {/* Tools bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <button
          onClick={escalate}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200"
        >
          <Headphones className="size-3.5" />
          {s("talkToPerson")}
        </button>

        <button
          onClick={() => setAutoRead((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            autoRead
              ? "border-brand/40 bg-brand/10 text-brand-light"
              : "border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200",
          )}
        >
          {autoRead ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          {s("autoRead")}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={m.id} className="group relative">
            <MessageBubble message={m} />

            {/* Quick-start suggestions under the welcome greeting. */}
            {showQuickActions && m.role === "assistant" && i === 0 && (
              <div className="mt-3 ml-9 flex flex-col gap-1.5">
                {quickActions.map((a, idx) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.label}
                      onClick={() => handleQuickAction(a)}
                      style={{ ["--reveal-delay" as string]: `${300 + idx * 130}ms` }}
                      className="reveal-item group/qa flex w-full items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-left text-[13px] text-zinc-300 transition-all duration-200 hover:border-brand/40 hover:bg-brand/10 hover:text-zinc-100 active:scale-[0.99]"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand/15 text-brand-light transition-colors group-hover/qa:bg-brand/25">
                        <Icon className="size-3.5" />
                      </span>
                      <span className="flex-1 leading-snug">{a.label}</span>
                      <ChevronRight className="size-4 shrink-0 text-zinc-600 transition-transform duration-200 group-hover/qa:translate-x-0.5 group-hover/qa:text-brand-light" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {escalation && (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100 animate-bubble-in">
            <LifeBuoy className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div>
              <p className="font-medium">{s("escalated")}</p>
              <p className="mt-0.5 text-amber-200/80">{s("escalatedMeta")}</p>
              <p className="mt-1 text-amber-200/80">{s("emergency")}</p>
            </div>
          </div>
        )}
      </div>

      {/* Voice notice */}
      {voiceNotice && (
        <div className="px-4 pb-1">
          <p className="text-center text-[11px] text-zinc-500">{voiceNotice}</p>
        </div>
      )}

      {/* Composer */}
      <div className="sticky bottom-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
        <Composer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={sending}
          placeholder={s("placeholder")}
          listening={listening}
          onToggleVoice={toggleVoiceInput}
          voiceSupported={voiceSupported}
        />
        <p className="mt-2 text-center text-[10px] text-zinc-600">
          TWC Assistant shares approved health information only and is not a doctor. For
          emergencies call 997 (ambulance) or 999 (police).
        </p>
      </div>
    </div>
  );
}

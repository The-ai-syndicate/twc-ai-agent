"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock,
  Loader2,
  Mail,
  MapPin,
  Search,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/ui/cn";

type MonthDay = { day: string; openSlots: number; firstSlot: string | null; lastSlot: string | null };
type DaySlot = { id: string; startsAt: string; endsAt: string; remaining: number };

export type AppointmentMode = "book" | "cancel" | "manage";

type ApptDetails = {
  reference?: string;
  status?: string;
  starts_at?: string;
  site_name?: string;
  site_town?: string;
  site_phone?: string;
  service_name?: string;
  neutral_label?: string;
};

type Props = {
  /** Optional. When omitted the client is asked to pick a centre first. */
  siteCode?: string;
  serviceCode?: string;
  siteName?: string;
  serviceName?: string;
  /** 'book' shows the calendar; 'cancel' shows the id lookup; 'manage' shows both. */
  mode?: AppointmentMode;
  onBooked?: (b: { reference: string; startsAt: string }) => void;
  onCancelled?: (reference: string) => void;
};

type Centre = {
  code: string;
  name: string;
  town: string | null;
  phone: string | null;
  services: { code: string; name: string }[];
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function iso(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso);
  return dt.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }) + " · " + dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function AppointmentCalendar({
  siteCode: siteCodeProp,
  serviceCode: serviceCodeProp,
  siteName: siteNameProp,
  serviceName: serviceNameProp,
  mode = "book",
  onBooked,
  onCancelled,
}: Props) {
  // 'manage' lets the client switch between booking and cancelling.
  const [tab, setTab] = useState<"book" | "cancel">(mode === "cancel" ? "cancel" : "book");
  const showTabs = mode === "manage";

  // The centre/service can be chosen inside the widget. A value passed in from
  // the chat (e.g. when the client named a centre) seeds the initial choice.
  const [siteCode, setSiteCode] = useState<string>(siteCodeProp ?? "");
  const [serviceCode, setServiceCode] = useState<string>(serviceCodeProp ?? "");
  const [siteName, setSiteName] = useState<string | undefined>(siteNameProp);
  const [serviceName, setServiceName] = useState<string | undefined>(serviceNameProp);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centresLoading, setCentresLoading] = useState(false);
  const [centresError, setCentresError] = useState<string | null>(null);
  const [pickingCentre, setPickingCentre] = useState(false);
  const [centreQuery, setCentreQuery] = useState("");

  useEffect(() => {
    if (siteCode) return; // already have a centre — no need to list them all
    let alive = true;
    setCentresLoading(true);
    setCentresError(null);
    fetch("/api/appointments/sites")
      .then((r) => r.json())
      .then((data: { sites?: Centre[] }) => {
        if (!alive) return;
        setCentres(data.sites ?? []);
      })
      .catch(() => {
        if (alive) setCentresError("Could not load the list of centres. Please try again.");
      })
      .finally(() => {
        if (alive) setCentresLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [siteCode]);

  const chooseCentre = useCallback(
    (centre: Centre, service?: { code: string; name: string }) => {
      const svc = service ?? centre.services[0];
      setSiteCode(centre.code);
      setSiteName(centre.name);
      setServiceCode(svc?.code ?? "");
      setServiceName(svc?.name);
      setPickingCentre(false);
      setSelectedDay(null);
      setSlots([]);
      setTab("book");
      // Force a reload of the month for the new centre/service.
      lastLoaded.current = "";
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Keep the tab in sync if the caller flips the mode prop.
  useEffect(() => {
    if (mode === "cancel") setTab("cancel");
  }, [mode]);

  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [days, setDays] = useState<Record<string, MonthDay>>({});
  const [loading, setLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<DaySlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ reference: string; startsAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The slot the client tapped, awaiting an email address before we book.
  const [pendingSlot, setPendingSlot] = useState<DaySlot | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [yearInputOpen, setYearInputOpen] = useState(false);
  const [yearInput, setYearInput] = useState(String(year));
  const lastLoaded = useRef<string>("");

  // --- Cancel flow state -----------------------------------------------------
  const [refInput, setRefInput] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelPreview, setCancelPreview] = useState<ApptDetails | null>(null);
  const [cancelledRef, setCancelledRef] = useState<string | null>(null);

  const loadMonth = useCallback(
    async (y: number, m: number) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          site_code: siteCode,
          service_code: serviceCode,
          year: String(y),
          month: String(m),
        });
        const res = await fetch(`/api/appointments/calendar?${qs}`);
        const data = (await res.json()) as { days?: MonthDay[] };
        const map: Record<string, MonthDay> = {};
        for (const d of data.days ?? []) map[d.day] = d;
        setDays(map);
      } catch {
        setDays({});
        setError("Could not load availability. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [siteCode, serviceCode],
  );

  useEffect(() => {
    if (tab !== "book") return;
    const key = `${year}-${month}`;
    if (lastLoaded.current === key) return;
    lastLoaded.current = key;
    void loadMonth(year, month);
  }, [year, month, loadMonth, tab]);

  const goto = useCallback((delta: number) => {
    setSelectedDay(null);
    setSlots([]);
    setMonth((m) => {
      const next = m + delta;
      if (next < 1) {
        setYear((y) => y - 1);
        return 12;
      }
      if (next > 12) {
        setYear((y) => y + 1);
        return 1;
      }
      return next;
    });
  }, []);

  const jumpToYearMonth = useCallback((y: number, m: number) => {
    setSelectedDay(null);
    setSlots([]);
    setYear(y);
    setMonth(m);
  }, []);

  const selectDay = useCallback(
    async (dayIso: string) => {
      const info = days[dayIso];
      if (!info || info.openSlots <= 0) return;
      setSelectedDay(dayIso);
      setSlotsLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          site_code: siteCode,
          service_code: serviceCode,
          year: String(year),
          month: String(month),
          day: dayIso,
        });
        const res = await fetch(`/api/appointments/calendar?${qs}`);
        const data = (await res.json()) as { slots?: DaySlot[] | null };
        setSlots(data.slots ?? []);
      } catch {
        setSlots([]);
        setError("Could not load times for that day.");
      } finally {
        setSlotsLoading(false);
      }
    },
    [days, siteCode, serviceCode, year, month],
  );

  // Tapping a slot doesn't book straight away — we ask where to send the
  // confirmation first so the client gets their unique appointment ID.
  const chooseSlot = useCallback((slot: DaySlot) => {
    setError(null);
    setPendingSlot(slot);
  }, []);

  const book = useCallback(
    async (slot: DaySlot, email: string) => {
      setPicking(slot.id);
      setError(null);
      try {
        const res = await fetch("/api/appointments/book", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            site_code: siteCode,
            service_code: serviceCode,
            slot_id: slot.id,
            starts_at: slot.startsAt,
            email,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          reference?: string;
          startsAt?: string;
          error?: string;
          needsVerification?: boolean;
        };
        if (!data.ok) {
          setError(data.error ?? "Could not book that time.");
          if (data.needsVerification) return;
          return;
        }
        const b = { reference: data.reference ?? "", startsAt: data.startsAt ?? slot.startsAt };
        setBooked(b);
        setPendingSlot(null);
        onBooked?.(b);
      } catch {
        setError("Could not book that time. Please try again.");
      } finally {
        setPicking(null);
      }
    },
    [siteCode, serviceCode, onBooked],
  );

  // Look up an appointment by its unique id (reference) and preview it.
  const lookupAppointment = useCallback(async () => {
    const reference = refInput.trim().toUpperCase();
    if (!reference) return;
    setCancelBusy(true);
    setCancelError(null);
    setCancelPreview(null);
    try {
      const res = await fetch("/api/appointments/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        details?: ApptDetails;
        error?: string;
        alreadyCancelled?: boolean;
      };
      if (!data.ok || !data.details) {
        setCancelError(data.error ?? "I could not find that appointment ID.");
        return;
      }
      setCancelPreview(data.details);
    } catch {
      setCancelError("Could not look up that appointment. Please try again.");
    } finally {
      setCancelBusy(false);
    }
  }, [refInput]);

  const confirmCancel = useCallback(async () => {
    const reference = (cancelPreview?.reference ?? refInput).trim().toUpperCase();
    if (!reference) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const res = await fetch("/api/appointments/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference, confirm: true }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) {
        setCancelError(data.error ?? "Could not cancel that appointment.");
        return;
      }
      setCancelledRef(reference);
      onCancelled?.(reference);
    } catch {
      setCancelError("Could not cancel that appointment. Please try again.");
    } finally {
      setCancelBusy(false);
    }
  }, [cancelPreview, refInput, onCancelled]);

  const { firstWeekday, daysInMonth } = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const dim = new Date(year, month, 0).getDate();
    return { firstWeekday: first.getDay(), daysInMonth: dim };
  }, [year, month]);

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const todayIso = iso(today.getFullYear(), today.getMonth() + 1, today.getDate());

  // --- Cancel confirmation screen -------------------------------------------
  if (cancelledRef) {
    return (
      <div className="apple-card overflow-hidden">
        <div className="twc-gradient-soft flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white">
          <Check className="size-4" />
          Appointment cancelled
        </div>
        <div className="space-y-2 p-4 text-sm text-zinc-200">
          <p>Your appointment has been cancelled and the time has been freed.</p>
          <div className="rounded-xl bg-white/5 px-3 py-2 text-xs text-zinc-400">
            Appointment ID <span className="font-medium text-zinc-200">{cancelledRef}</span>
          </div>
          <p className="text-xs text-zinc-500">
            You can book a new appointment any time by asking me here.
          </p>
        </div>
      </div>
    );
  }

  // --- Booking confirmation screen ------------------------------------------
  if (booked) {
    const dt = new Date(booked.startsAt);
    return (
      <div className="apple-card overflow-hidden">
        <div className="twc-gradient-soft flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white">
          <Check className="size-4" />
          Appointment booked
        </div>
        <div className="space-y-2 p-4 text-sm text-zinc-200">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-brand-light" />
            {dt.toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-brand-light" />
            {dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            {serviceName || siteName ? (
              <span className="text-zinc-400">
                · {[serviceName, siteName].filter(Boolean).join(" at ")}
              </span>
            ) : null}
          </div>
          <div className="rounded-xl bg-white/5 px-3 py-2 text-xs text-zinc-400">
            Appointment ID <span className="font-medium text-zinc-200">{booked.reference}</span>
          </div>
          <p className="text-xs text-zinc-500">
            A reminder will be sent 24 hours before. You can reschedule or cancel by giving me this
            appointment ID.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="apple-card overflow-hidden">
      {/* Header: site + service context */}
      <div className="twc-gradient-soft flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white">
        <CalendarDays className="size-4" />
        <span className="truncate">
          {tab === "cancel"
            ? "Cancel an appointment"
            : serviceName || "Choose a date"}
          {tab === "cancel"
            ? null
            : siteName
              ? <span className="font-normal opacity-90"> · {siteName}</span>
              : null}
        </span>
      </div>

      {/* Book / Cancel tabs (manage mode) */}
      {showTabs && (
        <div className="flex gap-1 border-b border-white/8 px-3 py-2">
          {(["book", "cancel"] as const).map((tb) => (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                tab === tb
                  ? "bg-brand text-white"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
              )}
            >
              {tb === "book" ? "Book" : "Cancel"}
            </button>
          ))}
        </div>
      )}

      {/* ---------------- Cancel panel ---------------- */}
      {tab === "cancel" && (
        <div className="space-y-3 p-4">
          {!cancelPreview ? (
            <>
              <p className="text-xs text-zinc-400">
                To cancel, enter your unique appointment ID (for example{" "}
                <span className="font-medium text-zinc-200">TWC-A-10231</span>). You&apos;ll find it
                on your booking confirmation.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void lookupAppointment();
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={refInput}
                  onChange={(e) => setRefInput(e.target.value)}
                  placeholder="TWC-A-10231"
                  autoCapitalize="characters"
                  className="sheet-input flex-1 rounded-xl px-3 py-2 text-sm uppercase"
                />
                <button
                  type="submit"
                  disabled={cancelBusy || !refInput.trim()}
                  className="twc-gradient-btn inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {cancelBusy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  Find
                </button>
              </form>
              {cancelError && (
                <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                  {cancelError}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-200">
                <p className="mb-1.5 text-xs font-medium text-zinc-400">Is this the appointment?</p>
                <div className="flex items-center gap-2">
                  <CalendarDays className="size-4 text-brand-light" />
                  {fmtDateTime(cancelPreview.starts_at)}
                </div>
                {(cancelPreview.service_name || cancelPreview.site_name) && (
                  <div className="mt-1 text-zinc-400">
                    {[cancelPreview.service_name, cancelPreview.site_name].filter(Boolean).join(" at ")}
                  </div>
                )}
                <div className="mt-2 rounded-xl bg-white/5 px-3 py-1.5 text-xs text-zinc-400">
                  Appointment ID{" "}
                  <span className="font-medium text-zinc-200">{cancelPreview.reference}</span>
                </div>
              </div>

              {cancelError && (
                <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                  {cancelError}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={confirmCancel}
                  disabled={cancelBusy}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500/90 px-3.5 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {cancelBusy ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                  Yes, cancel it
                </button>
                <button
                  onClick={() => {
                    setCancelPreview(null);
                    setCancelError(null);
                  }}
                  disabled={cancelBusy}
                  className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-zinc-300 hover:text-zinc-100 disabled:opacity-50"
                >
                  Keep it
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------- Book panel ---------------- */}
      {tab === "book" && (
        <>
          {!siteCode || !serviceCode || pickingCentre ? (
            <CentrePicker
              centres={centres}
              loading={centresLoading}
              error={centresError}
              query={centreQuery}
              onQuery={setCentreQuery}
              onChoose={chooseCentre}
              onCancel={pickingCentre && siteCode ? () => setPickingCentre(false) : undefined}
            />
          ) : (
            <>
              {/* Month / year navigation */}
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <button
                  onClick={() => goto(-1)}
                  aria-label="Previous month"
                  className="grid size-8 place-items-center rounded-full text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                >
                  <ChevronLeft className="size-4" />
                </button>

                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-zinc-100">{MONTHS[month - 1]}</span>
                  {yearInputOpen ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const y = Number(yearInput);
                        if (Number.isFinite(y) && y >= 2000 && y <= 2100) {
                          jumpToYearMonth(y, month);
                          setYearInputOpen(false);
                        }
                      }}
                    >
                      <input
                        autoFocus
                        value={yearInput}
                        onChange={(e) => setYearInput(e.target.value)}
                        onBlur={() => setYearInputOpen(false)}
                        inputMode="numeric"
                        className="sheet-input w-20 rounded-lg px-2 py-1 text-center text-sm"
                      />
                    </form>
                  ) : (
                    <button
                      onClick={() => {
                        setYearInput(String(year));
                        setYearInputOpen(true);
                      }}
                      className="rounded-lg px-2 py-0.5 text-sm font-medium text-brand-light hover:bg-white/5"
                      title="Jump to a year"
                    >
                      {year}
                    </button>
                  )}
                </div>

                <button
                  onClick={() => goto(1)}
                  aria-label="Next month"
                  className="grid size-8 place-items-center rounded-full text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>

              {/* Quick month jump chips */}
              <div className="flex flex-wrap gap-1 px-3 pb-2">
                {MONTHS.map((m, i) => (
                  <button
                    key={m}
                    onClick={() => jumpToYearMonth(year, i + 1)}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                      i + 1 === month
                        ? "bg-brand text-white"
                        : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300",
                    )}
                  >
                    {m.slice(0, 3)}
                  </button>
                ))}
              </div>

              {/* Weekday header */}
              <div className="grid grid-cols-7 gap-1 px-3 text-center text-[10px] font-medium uppercase text-zinc-600">
                {WEEKDAYS.map((d, i) => (
                  <div key={i} className="py-1">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-1 px-3 pb-3">
                {loading ? (
                  <div className="col-span-7 grid place-items-center py-8 text-zinc-500">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                ) : (
                  cells.map((d, i) => {
                    if (d === null) return <div key={`e${i}`} />;
                    const dayIso = iso(year, month, d);
                    const info = days[dayIso];
                    const open = (info?.openSlots ?? 0) > 0;
                    const isPast = dayIso < todayIso;
                    const isSelected = selectedDay === dayIso;
                    const isToday = dayIso === todayIso;
                    return (
                      <button
                        key={dayIso}
                        disabled={!open || isPast}
                        onClick={() => selectDay(dayIso)}
                        className={cn(
                          "relative grid aspect-square place-items-center rounded-xl text-sm transition-colors",
                          isSelected && "bg-brand text-white shadow-lg shadow-[#c93530]/25",
                          !isSelected && open && !isPast && "bg-white/5 text-zinc-100 hover:bg-brand/20",
                          (!open || isPast) && "text-zinc-600",
                          isToday && !isSelected && "ring-1 ring-brand/50",
                        )}
                        title={open ? `${info?.openSlots} open` : isPast ? "Past" : "No availability"}
                      >
                        {d}
                        {open && !isPast && !isSelected && (
                          <span className="absolute bottom-1 size-1 rounded-full bg-brand" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Time slots for the selected day */}
              {selectedDay && !pendingSlot && (
                <div className="border-t border-white/8 px-3 py-3">
                  <p className="mb-2 text-xs font-medium text-zinc-400">
                    {new Date(`${selectedDay}T00:00:00`).toLocaleDateString("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </p>
                  {slotsLoading ? (
                    <div className="grid place-items-center py-4 text-zinc-500">
                      <Loader2 className="size-4 animate-spin" />
                    </div>
                  ) : slots.length === 0 ? (
                    <p className="py-2 text-xs text-zinc-500">No times left for this day — try another.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {slots.map((slot) => {
                        const slotTime = new Date(slot.startsAt);
                        return (
                          <button
                            key={slot.id}
                            disabled={picking !== null}
                            onClick={() => chooseSlot(slot)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-brand/40 hover:bg-brand/10 disabled:opacity-50",
                              picking === slot.id && "border-brand bg-brand/15",
                            )}
                          >
                            {picking === slot.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Clock className="size-3 text-brand-light" />
                            )}
                            {slotTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Email step — ask where to send the confirmation before booking */}
              {pendingSlot && (
                <div className="space-y-3 border-t border-white/8 px-3 py-3">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-brand/15 text-brand-light">
                      <Mail className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-100">
                        Where should I send your booking details?
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        I&apos;ll email your confirmation and appointment ID to this address.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-white/5 px-3 py-2 text-xs text-zinc-300">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="size-3.5 text-brand-light" />
                      {new Date(pendingSlot.startsAt).toLocaleDateString("en-GB", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-zinc-400">
                      <Clock className="size-3.5 text-brand-light" />
                      {new Date(pendingSlot.startsAt).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {serviceName || siteName ? (
                        <span>· {[serviceName, siteName].filter(Boolean).join(" at ")}</span>
                      ) : null}
                    </div>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const value = emailInput.trim();
                      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                        setError("That doesn't look like an email address — please check and try again.");
                        return;
                      }
                      void book(pendingSlot, value);
                    }}
                    className="space-y-2"
                  >
                    <input
                      autoFocus
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="sheet-input w-full rounded-xl px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={picking !== null || !emailInput.trim()}
                        className="twc-gradient-btn inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {picking !== null ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Check className="size-4" />
                        )}
                        Confirm booking
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingSlot(null);
                          setError(null);
                        }}
                        disabled={picking !== null}
                        className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-zinc-300 hover:text-zinc-100 disabled:opacity-50"
                      >
                        Back
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {siteName && (
                <div className="flex items-center justify-between gap-1.5 border-t border-white/8 px-3 py-2 text-[11px] text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-3" />
                    {siteName}
                  </span>
                  <button
                    onClick={() => {
                      setCentresError(null);
                      setPickingCentre(true);
                    }}
                    className="rounded-full px-2 py-0.5 text-brand-light hover:bg-white/5"
                  >
                    Change centre
                  </button>
                </div>
              )}

              {error && (
                <div className="border-t border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                  {error}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Centre picker — the client must choose a centre before seeing availability.
// Shows every Tebelopele centre (and what it offers), with a quick filter.
// ---------------------------------------------------------------------------
function CentrePicker({
  centres,
  loading,
  error,
  query,
  onQuery,
  onChoose,
  onCancel,
}: {
  centres: Centre[];
  loading: boolean;
  error: string | null;
  query: string;
  onQuery: (v: string) => void;
  onChoose: (centre: Centre, service?: { code: string; name: string }) => void;
  onCancel?: () => void;
}) {
  const [openCode, setOpenCode] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? centres.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.town ?? "").toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q),
      )
    : centres;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-400">Choose a centre to see available dates.</p>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-full px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          >
            Back
          </button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search centres or towns…"
          className="sheet-input w-full rounded-xl py-2 pl-8 pr-3 text-sm"
        />
      </div>

      {loading ? (
        <div className="grid place-items-center py-8 text-zinc-500">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : error ? (
        <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-500">No centres match “{query}”.</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-0.5">
          {filtered.map((c) => {
            const expanded = openCode === c.code;
            const multiService = c.services.length > 1;
            return (
              <li key={c.code}>
                <button
                  onClick={() => {
                    if (multiService) {
                      setOpenCode(expanded ? null : c.code);
                    } else {
                      onChoose(c);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-brand/10",
                    expanded && "border-brand/40 bg-brand/10",
                  )}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand/15 text-brand-light">
                    <MapPin className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-100">
                      {c.name}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      {c.town ?? "Botswana"}
                    </span>
                  </span>
                  <ChevronRight
                    className={cn("size-4 shrink-0 text-zinc-600 transition-transform", expanded && "rotate-90")}
                  />
                </button>

                {expanded && (
                  <div className="mt-1 space-y-1 pl-3">
                    <p className="px-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                      Choose a service
                    </p>
                    {c.services.map((svc) => (
                      <button
                        key={svc.code}
                        onClick={() => onChoose(c, svc)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/5 hover:text-zinc-100"
                      >
                        <ChevronRight className="size-3 text-zinc-600" />
                        {svc.name}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

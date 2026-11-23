import { useCallback, useEffect, useMemo, useState } from "react";
import { LandingPage } from "./components/LandingPage";
import { TimelineStrip } from "./components/TimelineStrip";
import { parseSmartSearch, toRecommendations } from "./lib/ranking";
import type { QuickChipId, RoomApiItem, RoomRecommendation, SearchResponse, Term } from "./types";

type View = "landing" | "chooser" | "loading" | "results";
type StudyChoiceId = "anywhere" | "geisel" | "cse" | "long_block";

type StudyChoice = {
  id: StudyChoiceId;
  title: string;
  subtitle: string;
  kicker: string;
  query: string;
  durationMin?: number;
  chips?: QuickChipId[];
};

const STUDY_CHOICES: StudyChoice[] = [
  {
    id: "anywhere",
    title: "Anywhere easy",
    subtitle: "Show the strongest rooms right now with the least friction.",
    kicker: "Fastest path",
    query: "room now",
    durationMin: 60,
    chips: ["now"],
  },
  {
    id: "geisel",
    title: "Near Geisel",
    subtitle: "Bias toward central campus study spots near Geisel.",
    kicker: "Central campus",
    query: "near geisel room now",
    durationMin: 60,
    chips: ["now", "nearGeisel"],
  },
  {
    id: "cse",
    title: "Near CSE",
    subtitle: "Focus on engineering-side rooms around the CSE area.",
    kicker: "North campus",
    query: "near cse room now",
    durationMin: 60,
    chips: ["now", "nearCse"],
  },
  {
    id: "long_block",
    title: "Long study block",
    subtitle: "Prefer rooms that stay free longer so you can settle in.",
    kicker: "2+ hours",
    query: "room for 90 min",
    durationMin: 120,
    chips: ["oneToTwo"],
  },
];

export function App() {
  const now = new Date();
  const nowDateDefault = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const nowTimeDefault = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const [terms, setTerms] = useState<Term[]>([]);
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("room now");
  const [chips, setChips] = useState<Set<QuickChipId>>(new Set(["now"]));
  const [selectedDate, setSelectedDate] = useState(nowDateDefault);
  const [selectedTime, setSelectedTime] = useState(nowTimeDefault);
  const [durationMin, setDurationMin] = useState(60);
  const [day, setDay] = useState(dayCodeFromDate(nowDateDefault));
  const [start, setStart] = useState(nowTimeDefault);
  const [end, setEnd] = useState(addMinutesToTime(nowTimeDefault, 60));
  const [building, setBuilding] = useState("");
  const [minFreeMin, setMinFreeMin] = useState(30);
  const [whiteboard, setWhiteboard] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [rooms, setRooms] = useState<RoomApiItem[]>([]);
  const [view, setView] = useState<View>("landing");
  const [selectedChoiceId, setSelectedChoiceId] = useState<StudyChoiceId>("anywhere");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/terms")
      .then((r) => r.json())
      .then((j) => {
        const t = j.terms as Term[];
        setTerms(t);
        if (t.length) {
          setTerm((prev) => prev || pickDefaultTerm(t));
        }
      })
      .catch(() => setErr("Could not load terms from UCSD."));
  }, []);

  useEffect(() => {
    setDay(dayCodeFromDate(selectedDate));
    setStart(selectedTime);
    setEnd(addMinutesToTime(selectedTime, durationMin));
  }, [selectedDate, selectedTime, durationMin]);

  const executeSearch = useCallback(async () => {
    if (!term) return [];
    setLoading(true);
    setErr(null);
    try {
      const u = new URL("/api/rooms/search", window.location.origin);
      u.searchParams.set("term", term);
      u.searchParams.set("day", day);
      u.searchParams.set("start", start);
      u.searchParams.set("end", end);
      if (building.trim()) u.searchParams.set("building", building.trim());
      if (minFreeMin > 0) u.searchParams.set("minFreeMin", String(minFreeMin));
      if (whiteboard) u.searchParams.set("whiteboard", "1");
      const t0 = performance.now();
      const r = await fetch(u);
      const elapsed = performance.now() - t0;
      if (!r.ok) { const body = await r.json().catch(() => null); throw new Error(body?.error?.message ?? r.statusText); }
      const data = (await r.json()) as SearchResponse;
      setMs(elapsed);
      setRooms(data.rooms);
      return data.rooms;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRooms([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [term, day, start, end, building, minFreeMin, whiteboard]);

  const searchIntent = useMemo(() => parseSmartSearch(query), [query]);
  const recommendations = useMemo(
    () => toRecommendations(rooms, { areaHint: searchIntent.areaHint, minDuration: searchIntent.durationMin ?? minFreeMin }),
    [rooms, searchIntent, minFreeMin]
  );
  const selectedRoom =
    recommendations.find((room) => room.roomId === selectedRoomId) ?? recommendations[0] ?? null;

  useEffect(() => {
    if (!recommendations.length) {
      setSelectedRoomId(null);
      return;
    }
    setSelectedRoomId((prev) => (prev && recommendations.some((room) => room.roomId === prev) ? prev : recommendations[0]!.roomId));
  }, [recommendations]);

  const startNowFlow = () => {
    applyChoice(STUDY_CHOICES[0]!);
    setView("loading");
    void runSearchFlow();
  };

  const openChooser = () => {
    setView("chooser");
  };

  const applyChoice = (choice: StudyChoice) => {
    setSelectedChoiceId(choice.id);
    setQuery(choice.query);
    setDurationMin(choice.durationMin ?? 60);
    setChips(new Set(choice.chips ?? []));
    setBuilding("");
    if (choice.id === "geisel") setBuilding("Geisel");
    if (choice.id === "cse") setBuilding("CSE");
    setMinFreeMin(choice.id === "long_block" ? 90 : 30);
  };

  const runSearchFlow = async () => {
    setView("loading");
    const results = await executeSearch();
    setSelectedRoomId(results[0]?.roomId ?? null);
    setView("results");
  };

  const chooseStudyMode = (choice: StudyChoice) => {
    applyChoice(choice);
    void runSearchFlow();
  };

  return (
    <div className="min-h-screen bg-[#f4f4f4]">
      {view === "landing" ? (
        <LandingPage onStartNow={startNowFlow} onStartCustom={openChooser} />
      ) : null}

      {view === "chooser" ? (
        <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 md:px-8">
          <section className="w-full rounded-[2.25rem] border border-black bg-white p-6 shadow-[10px_10px_0_0_rgba(0,0,0,0.92)] md:p-8">
            <div className="max-w-2xl">
              <p className="animate-slide-up-fade text-xs font-semibold uppercase tracking-[0.24em] text-black/55">
                Study Mode
              </p>
              <h1 className="animate-slide-up-fade mt-3 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
                Where would you like to study?
              </h1>
              <p className="animate-slide-up-fade mt-4 text-sm leading-7 text-black/65">
                Pick the vibe first. We will search, load a short ranked list, and let you open one room at a time.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {STUDY_CHOICES.map((choice, index) => (
                <button
                  key={choice.id}
                  onClick={() => chooseStudyMode(choice)}
                  className="animate-slide-up-fade group rounded-[1.75rem] border border-black bg-[#fbfbfb] p-5 text-left transition hover:-translate-y-1 hover:bg-[#f5efdf] hover:shadow-[7px_7px_0_0_rgba(0,0,0,0.88)]"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-full border border-black px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-black/60">
                      {choice.kicker}
                    </span>
                    <span className="text-xl transition-transform group-hover:translate-x-1">+</span>
                  </div>
                  <h2 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">{choice.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-black/65">{choice.subtitle}</p>
                </button>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => setView("landing")}
                className="rounded-2xl border border-black bg-white px-4 py-3 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:bg-black/5"
              >
                Back
              </button>
              <div className="rounded-2xl border border-black/15 bg-[#f8f8f8] px-4 py-3 text-sm text-black/65">
                Date: {selectedDate} at {selectedTime}
              </div>
            </div>
          </section>
        </main>
      ) : null}

      {view === "loading" ? (
        <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-4 py-10 md:px-8">
          <section className="w-full rounded-[2.25rem] border border-black bg-white p-8 shadow-[10px_10px_0_0_rgba(0,0,0,0.92)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/55">Searching</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 md:text-5xl">
              Finding rooms for {STUDY_CHOICES.find((choice) => choice.id === selectedChoiceId)?.title.toLowerCase()}.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-black/65">
              Pulling a focused list, ranking the names, and preparing the room details.
            </p>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="rounded-[1.5rem] border border-black bg-[#fbfbfb] p-5">
                  <div className="loading-shimmer h-4 w-20 rounded-full" />
                  <div className="loading-shimmer mt-5 h-10 w-32 rounded-full" />
                  <div className="loading-shimmer mt-8 h-3 w-full rounded-full" />
                  <div className="loading-shimmer mt-3 h-3 w-4/5 rounded-full" />
                </div>
              ))}
            </div>

            <div className="mt-10 flex items-center gap-4">
              <div className="loading-orbit" />
              <p className="text-sm font-medium text-black/60">Ranking best available rooms now...</p>
            </div>
          </section>
        </main>
      ) : null}

      {view === "results" ? (
        <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-8 md:px-8">
          <div className="grid gap-5 lg:grid-cols-[0.95fr_1.45fr]">
            <section className="rounded-[2rem] border border-black bg-white p-5 shadow-[8px_8px_0_0_rgba(0,0,0,0.9)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/55">Suggested Rooms</p>
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Pick a room name.</h1>
                  <p className="mt-3 text-sm leading-6 text-black/65">
                    Keep the list lightweight. Open one option and inspect the details on the right.
                  </p>
                </div>
                <span className="rounded-full border border-black bg-[#f8f8f8] px-4 py-2 text-sm font-semibold text-black">
                  {recommendations.length} rooms
                </span>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={() => setView("chooser")}
                  className="rounded-2xl border border-black bg-white px-4 py-2 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:bg-black/5"
                >
                  Change study mode
                </button>
                <button
                  onClick={() => void runSearchFlow()}
                  className="rounded-2xl border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black/90"
                >
                  Refresh list
                </button>
              </div>

              <div className="mt-6 rounded-[1.5rem] border border-black bg-[#fbfbfb] p-3">
                <div className="space-y-2">
                  {recommendations.map((room, index) => (
                    <button
                      key={room.roomId}
                      onClick={() => setSelectedRoomId(room.roomId)}
                      className={`animate-fade-in-up flex w-full items-center justify-between rounded-[1.15rem] border px-4 py-3 text-left transition ${
                        selectedRoom?.roomId === room.roomId
                          ? "border-black bg-[#f4efe4] shadow-[4px_4px_0_0_rgba(0,0,0,0.82)]"
                          : "border-black/15 bg-white hover:border-black hover:bg-[#fffaf0]"
                      }`}
                      style={{ animationDelay: `${index * 45}ms` }}
                    >
                      <div>
                        <div className="text-lg font-semibold text-slate-900">
                          {room.building} {room.room}
                        </div>
                        <div className="mt-1 text-sm text-black/60">{room.statusLabel}</div>
                      </div>
                      <div className="text-sm font-medium text-black/50">{room.freeEndLabel}</div>
                    </button>
                  ))}
                  {!loading && recommendations.length === 0 ? (
                    <div className="rounded-[1.15rem] border border-black bg-white px-4 py-6 text-sm text-black/65">
                      No rooms matched this pass. Try a different study mode.
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="rounded-[2rem] border border-black bg-white p-6 shadow-[8px_8px_0_0_rgba(0,0,0,0.9)]">
              {selectedRoom ? (
                <RoomDetail room={selectedRoom} ms={ms} selectedChoiceId={selectedChoiceId} />
              ) : (
                <div className="flex min-h-[28rem] items-center justify-center rounded-[1.5rem] border border-black bg-[#fbfbfb] p-8 text-center text-black/60">
                  Select a room name to open the detail view.
                </div>
              )}
            </section>
          </div>
        </main>
      ) : null}
    </div>
  );
}

function RoomDetail({ room, ms, selectedChoiceId }: { room: RoomRecommendation; ms: number | null; selectedChoiceId: StudyChoiceId }) {
  return (
    <div className="animate-map-enter">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/55">Room Details</p>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-4xl font-semibold tracking-tight text-slate-900">
            {room.building} {room.room}
          </h2>
          <p className="mt-3 text-lg text-black/65">
            {room.statusLabel} until {room.freeEndLabel}
          </p>
        </div>
        {room.isBest ? (
          <span className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white">
            Best option right now
          </span>
        ) : null}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <DetailMetric label="Study mode" value={STUDY_CHOICES.find((choice) => choice.id === selectedChoiceId)?.title ?? "Custom"} />
        <DetailMetric label="Open window" value={`${room.freeStartLabel} - ${room.freeEndLabel}`} />
        <DetailMetric label="Search time" value={ms !== null ? `${ms.toFixed(0)} ms` : "--"} />
      </div>

      <div className="mt-6 rounded-[1.5rem] border border-black bg-[#f5efdf] p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-black/50">Snapshot</p>
        <div className="mt-4 space-y-3 text-lg text-slate-700">
          <p>{room.nearbyLabel}</p>
          <p>{room.descriptor}</p>
          <p>{room.nextClassLabel}</p>
        </div>
        <div className="mt-5">
          <TimelineStrip startMin={room.freeStartMin} endMin={room.freeEndMin} />
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <div className="rounded-[1.5rem] border border-black bg-[#fbfbfb] p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-black/50">Building</p>
          <p className="mt-3 text-2xl font-semibold text-slate-900">{room.building}</p>
          <p className="mt-2 text-sm leading-6 text-black/65">{room.buildingMeta}</p>
        </div>
        <div className="rounded-[1.5rem] border border-black bg-[#fbfbfb] p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-black/50">Why this works</p>
          <p className="mt-3 text-lg leading-7 text-slate-700">
            This room is ranked highly because it matches the selected study mode and stays open long enough to matter.
          </p>
        </div>
      </div>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-black bg-[#fbfbfb] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/50">{label}</p>
      <p className="mt-3 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function dayCodeFromDate(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  const map = ["S", "M", "T", "W", "R", "F", "S"];
  return map[d.getDay()] ?? "M";
}

function addMinutesToTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  const base = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  const total = Math.min(23 * 60 + 59, Math.max(0, base + minutes));
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function pickDefaultTerm(terms: Term[]): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const month = now.getMonth() + 1;

  let wantedPrefixes: string[];
  if (month >= 1 && month <= 3) wantedPrefixes = ["WI"];
  else if (month >= 4 && month <= 6) wantedPrefixes = ["SP"];
  else if (month >= 7 && month <= 9) wantedPrefixes = ["SA", "SU", "S1", "S2", "S3"];
  else wantedPrefixes = ["FA"];

  const exact = terms.find((t) => wantedPrefixes.some((p) => t.code.startsWith(p)) && t.code.endsWith(yy));
  if (exact) return exact.code;

  const fallback = terms.find((t) => /^(SP|WI|FA|SA|SU)\d{2}$/.test(t.code));
  return fallback?.code ?? terms[0]!.code;
}

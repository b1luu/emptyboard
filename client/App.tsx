import { useCallback, useEffect, useMemo, useState } from "react";
import { AdvancedFilters } from "./components/AdvancedFilters";
import { CampusMapPanel } from "./components/CampusMapPanel";
import { LandingPage } from "./components/LandingPage";
import { QuickFilters } from "./components/QuickFilters";
import { RoomCard } from "./components/RoomCard";
import { SearchBar } from "./components/SearchBar";
import { parseSmartSearch, toRecommendations } from "./lib/ranking";
import type { QuickChipId, RoomApiItem, SearchResponse, Term } from "./types";

function includesBuilding(room: RoomApiItem, selectedBuilding: string): boolean {
  if (!selectedBuilding) return true;
  return room.building.toLowerCase().includes(selectedBuilding.toLowerCase());
}

export function App() {
  const now = new Date();
  const nowDateDefault = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const nowTimeDefault = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const [terms, setTerms] = useState<Term[]>([]);
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<Set<QuickChipId>>(new Set(["now"]));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedDate, setSelectedDate] = useState(nowDateDefault);
  const [selectedTime, setSelectedTime] = useState(nowTimeDefault);
  const [durationMin, setDurationMin] = useState(60);
  const [day, setDay] = useState(dayCodeFromDate(nowDateDefault));
  const [start, setStart] = useState(nowTimeDefault);
  const [end, setEnd] = useState(addMinutesToTime(nowTimeDefault, 60));
  const [building, setBuilding] = useState("");
  const [selectedBuilding, setSelectedBuilding] = useState("");
  const [minFreeMin, setMinFreeMin] = useState(30);
  const [whiteboard, setWhiteboard] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [rooms, setRooms] = useState<RoomApiItem[]>([]);
  const [hasEnteredListView, setHasEnteredListView] = useState(false);
  const [isEnteringMap, setIsEnteringMap] = useState(false);
  const [focusedRoomId, setFocusedRoomId] = useState<string | null>(null);

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
    if (!term) return;
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
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error);
      const data = (await r.json()) as SearchResponse;
      setMs(elapsed);
      setRooms(data.rooms);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, [term, day, start, end, building, minFreeMin, whiteboard]);

  useEffect(() => {
    if (term && hasEnteredListView) void executeSearch();
  }, [term, executeSearch, hasEnteredListView]);

  const onChipToggle = (id: QuickChipId) => {
    const next = new Set(chips);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChips(next);
    if (id === "now") {
      setQuery("room now");
      const n = new Date();
      const d = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
      const t = `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
      setSelectedDate(d);
      setSelectedTime(t);
      setDurationMin(60);
      setTimeout(() => {
        void executeSearch();
      }, 0);
    }
    if (id === "next30") {
      setQuery("room for 30 min");
      setDurationMin(30);
    }
    if (id === "oneToTwo") {
      setQuery("room for 90 min");
      setDurationMin(120);
    }
    if (id === "nearGeisel") setQuery("near geisel room now");
    if (id === "nearCse") setQuery("near cse room now");
  };

  const searchIntent = useMemo(() => parseSmartSearch(query), [query]);
  const filteredRooms = useMemo(
    () => rooms.filter((r) => includesBuilding(r, selectedBuilding)),
    [rooms, selectedBuilding]
  );
  const recommendations = useMemo(
    () => toRecommendations(filteredRooms, { areaHint: searchIntent.areaHint, minDuration: searchIntent.durationMin ?? minFreeMin }),
    [filteredRooms, searchIntent, minFreeMin]
  );

  useEffect(() => {
    if (!focusedRoomId) return;
    const el = document.getElementById(`room-card-${focusedRoomId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFocusedRoomId(null), 1400);
    return () => clearTimeout(t);
  }, [focusedRoomId]);

  const enterNow = () => {
    const n = new Date();
    const d = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    const t = `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
    setSelectedDate(d);
    setSelectedTime(t);
    setDurationMin(60);
    setQuery("room now");
    setHasEnteredListView(true);
    setIsEnteringMap(true);
    setTimeout(() => setIsEnteringMap(false), 550);
    setTimeout(() => {
      void executeSearch();
    }, 0);
  };

  const enterCustom = () => {
    setHasEnteredListView(true);
    setIsEnteringMap(true);
    setTimeout(() => setIsEnteringMap(false), 550);
    setShowAdvanced(true);
    setTimeout(() => {
      void executeSearch();
    }, 0);
  };

  return (
    <div className={hasEnteredListView ? "min-h-screen bg-[#f4f4f4] pb-10" : "min-h-screen bg-[#f4f4f4]"}>
      {!hasEnteredListView ? (
        <LandingPage onStartNow={enterNow} onStartCustom={enterCustom} />
      ) : (
        <>
      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => executeSearch()}
        term={term}
        terms={terms}
        onTermChange={setTerm}
        selectedDate={selectedDate}
        selectedTime={selectedTime}
        durationMin={durationMin}
        onDateChange={setSelectedDate}
        onTimeChange={setSelectedTime}
        onDurationChange={setDurationMin}
      />
      <QuickFilters active={chips} onToggle={onChipToggle} showAdvanced={showAdvanced} onToggleAdvanced={() => setShowAdvanced((v) => !v)} />
      <AdvancedFilters
        open={showAdvanced}
        day={day}
        start={start}
        end={end}
        minFreeMin={minFreeMin}
        building={building}
        whiteboard={whiteboard}
        onChange={(p) => {
          if (p.day !== undefined) setDay(p.day);
          if (p.start !== undefined) setStart(p.start);
          if (p.end !== undefined) setEnd(p.end);
          if (p.minFreeMin !== undefined) setMinFreeMin(p.minFreeMin);
          if (p.building !== undefined) setBuilding(p.building);
          if (p.whiteboard !== undefined) setWhiteboard(p.whiteboard);
        }}
      />

      <main className={`mx-auto mt-4 grid w-full max-w-7xl gap-4 px-4 md:grid-cols-12 md:px-6 ${isEnteringMap ? "animate-map-enter" : ""}`}>
        <section className="space-y-3 md:col-span-8 lg:col-span-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{loading ? "Refreshing map + recommendations..." : `${recommendations.length} recommendations`}</span>
              {ms !== null ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">~{ms.toFixed(0)} ms</span> : null}
            </div>
            {err ? <p className="mt-2 text-rose-600">{err}</p> : null}
          </div>
          <CampusMapPanel
            rooms={recommendations}
            selectedBuilding={selectedBuilding}
            onSelectBuilding={setSelectedBuilding}
            onFocusRoom={setFocusedRoomId}
          />
        </section>
        <section className="space-y-3 md:col-span-4 lg:col-span-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700 shadow-soft">
            Suggested rooms
          </div>
          {recommendations.map((r, i) => (
            <RoomCard key={r.roomId} room={r} index={i} highlighted={focusedRoomId === r.roomId} />
          ))}
          {!loading && recommendations.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              No room recommendations yet. Try removing filters or selecting a different building.
            </div>
          ) : null}
        </section>
      </main>
        </>
      )}
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

  // UCSD-ish mapping:
  // Jan-Mar => WI, Apr-Jun => SP, Jul-Sep => SA/SU/S1/S2/S3, Oct-Dec => FA
  let wantedPrefixes: string[];
  if (month >= 1 && month <= 3) wantedPrefixes = ["WI"];
  else if (month >= 4 && month <= 6) wantedPrefixes = ["SP"];
  else if (month >= 7 && month <= 9) wantedPrefixes = ["SA", "SU", "S1", "S2", "S3"];
  else wantedPrefixes = ["FA"];

  const exact = terms.find((t) => wantedPrefixes.some((p) => t.code.startsWith(p)) && t.code.endsWith(yy));
  if (exact) return exact.code;

  // Fallback to nearest standard term ordering if exact current-quarter code is absent.
  const fallback = terms.find((t) => /^(SP|WI|FA|SA|SU)\d{2}$/.test(t.code));
  return fallback?.code ?? terms[0]!.code;
}

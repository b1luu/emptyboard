import { useCallback, useEffect, useState } from "react";

type Term = { code: string; label: string };

type FreeNowResponse = {
  term: string;
  timezone: string;
  now: { day: string | null; minutes: number; weekdayLabel: string };
  campusDay: boolean;
  count: number;
  whiteboardPlaceholder?: boolean;
  rooms: {
    building: string;
    room: string;
    roomId: string;
    status: string;
    freeWindow: {
      startMin: number;
      endMin: number;
      startLabel: string;
      endLabel: string;
    } | null;
    nextClass: { startsAtLabel: string; label: string } | null;
  }[];
};

type SearchResponse = {
  term: string;
  day: string;
  window: { startMin: number; endMin: number; startLabel: string; endLabel: string };
  count: number;
  whiteboardPlaceholder?: boolean;
  rooms: {
    building: string;
    room: string;
    roomId: string;
    status: string;
    freeWindow: { startLabel: string; endLabel: string };
    nextClass: { startsAtLabel: string; label: string } | null;
  }[];
};

export function App() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [term, setTerm] = useState("");
  const [mode, setMode] = useState<"now" | "search">("now");
  const [day, setDay] = useState("Tu");
  const [start, setStart] = useState("14:00");
  const [end, setEnd] = useState("16:00");
  const [building, setBuilding] = useState("");
  const [minFreeMin, setMinFreeMin] = useState(30);
  const [whiteboard, setWhiteboard] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [freeNow, setFreeNow] = useState<FreeNowResponse | null>(null);
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/terms")
      .then((r) => r.json())
      .then((j) => {
        const t = j.terms as Term[];
        setTerms(t);
        if (t.length) {
          setTerm((prev) => {
            if (prev) return prev;
            const preferred = t.find((x) => /SP\d{2}|WI\d{2}|FA\d{2}/.test(x.code));
            return preferred?.code ?? t[0]!.code;
          });
        }
      })
      .catch(() => setErr("Could not load terms from UCSD."));
  }, []);

  const runFreeNow = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setSearchData(null);
    try {
      const u = new URL("/api/rooms/free-now", window.location.origin);
      u.searchParams.set("term", term);
      if (building.trim()) u.searchParams.set("building", building.trim());
      if (minFreeMin > 0) u.searchParams.set("minFreeMin", String(minFreeMin));
      if (whiteboard) u.searchParams.set("whiteboard", "1");
      const t0 = performance.now();
      const r = await fetch(u);
      const msClient = performance.now() - t0;
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? r.statusText);
      }
      setMs(msClient);
      setFreeNow((await r.json()) as FreeNowResponse);
    } catch (e) {
      setFreeNow(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [term, building, minFreeMin, whiteboard]);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setFreeNow(null);
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
      const msClient = performance.now() - t0;
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? r.statusText);
      }
      setMs(msClient);
      setSearchData((await r.json()) as SearchResponse);
    } catch (e) {
      setSearchData(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [term, day, start, end, building, minFreeMin, whiteboard]);

  const statusClass = (s: string) => {
    if (s === "open_now") return "status open";
    if (s === "opens_later") return "status later";
    return "status";
  };

  return (
    <>
      <header>
        <h1>EmptyBoard</h1>
        <p className="sub">
          Find <strong>empty classrooms</strong> from UCSD’s public Schedule of Classes. We derive occupied time blocks per
          room, merge overlaps, then compute <strong>free windows</strong> inside a daily campus window (default 8:00–22:00
          Pacific). All deterministic—no LLM on the request path.
        </p>
      </header>

      <div className="panel">
        <div className="row">
          <label>
            Quarter
            <select value={term} onChange={(e) => setTerm(e.target.value)}>
              {terms.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label} ({t.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as "now" | "search")}>
              <option value="now">Open now</option>
              <option value="search">Free in time window</option>
            </select>
          </label>
          {mode === "search" && (
            <>
              <label>
                Day
                <input type="text" value={day} onChange={(e) => setDay(e.target.value)} placeholder="Tu, M, Th…" />
              </label>
              <label>
                Start
                <input type="text" value={start} onChange={(e) => setStart(e.target.value)} placeholder="14:00" />
              </label>
              <label>
                End
                <input type="text" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="16:00" />
              </label>
            </>
          )}
          <label>
            Building / area
            <input
              type="search"
              value={building}
              onChange={(e) => setBuilding(e.target.value)}
              placeholder="e.g. PETER, CSE"
            />
          </label>
          <label>
            Min free (min)
            <input
              type="number"
              min={0}
              step={5}
              value={minFreeMin}
              onChange={(e) => setMinFreeMin(parseInt(e.target.value, 10) || 0)}
            />
          </label>
          <label className="toggle">
            <span className="toggle-label">Whiteboard (placeholder)</span>
            <input type="checkbox" checked={whiteboard} onChange={(e) => setWhiteboard(e.target.checked)} />
          </label>
          <button
            type="button"
            disabled={loading || !term}
            onClick={() => (mode === "now" ? runFreeNow() : runSearch())}
          >
            {loading ? "…" : mode === "now" ? "Find open now" : "Search rooms"}
          </button>
        </div>
        {err && <p className="warn">{err}</p>}
        {ms !== null && (
          <div className="meta">
            <span className="badge">~{ms.toFixed(0)} ms (client)</span>
            {(freeNow?.whiteboardPlaceholder || searchData?.whiteboardPlaceholder) && (
              <span className="badge muted">Whiteboard filter not implemented</span>
            )}
          </div>
        )}
      </div>

      {freeNow && (
        <div className="panel">
          <p className="sub" style={{ marginTop: 0 }}>
            Pacific: <strong>{freeNow.now.weekdayLabel}</strong>
            {freeNow.now.day === null
              ? " — weekend / no letter day; “open now” is not modeled."
            : freeNow.campusDay
              ? ` — campus day code ${freeNow.now.day}`
              : ""}{" "}
            · {freeNow.timezone}
          </p>
          {freeNow.now.day === null ? (
            <p className="warn">Try “Free in time window” for a specific weekday.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Status</th>
                    <th>Free window</th>
                    <th>Next class</th>
                  </tr>
                </thead>
                <tbody>
                  {freeNow.rooms.map((r) => (
                    <tr key={r.roomId}>
                      <td className="mono">
                        {r.building} {r.room}
                        <div className="detail-link">
                          <a
                            href={`/api/rooms/${encodeURIComponent(r.roomId)}/availability?term=${encodeURIComponent(term)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            JSON availability
                          </a>
                        </div>
                      </td>
                      <td>
                        <span className={statusClass(r.status)}>
                          {r.status === "open_now"
                            ? "Open now"
                            : r.status === "opens_later"
                              ? "Opens later"
                              : "In use / closed"}
                        </span>
                      </td>
                      <td className="mono">
                        {r.freeWindow ? `${r.freeWindow.startLabel}–${r.freeWindow.endLabel}` : "—"}
                      </td>
                      <td>{r.nextClass ? `${r.nextClass.label} @ ${r.nextClass.startsAtLabel}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {searchData && (
        <div className="panel">
          <p className="sub" style={{ marginTop: 0 }}>
            Day <strong>{searchData.day}</strong> · entire slot free{" "}
            <strong>
              {searchData.window.startLabel}–{searchData.window.endLabel}
            </strong>{" "}
            ({searchData.count} rooms)
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Status</th>
                  <th>Containing free window</th>
                  <th>Next class after window</th>
                </tr>
              </thead>
              <tbody>
                {searchData.rooms.map((r) => (
                  <tr key={r.roomId}>
                    <td className="mono">
                      {r.building} {r.room}
                      <div className="detail-link">
                        <a
                          href={`/api/rooms/${encodeURIComponent(r.roomId)}/availability?term=${encodeURIComponent(term)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          JSON availability
                        </a>
                      </div>
                    </td>
                    <td>
                      <span className={statusClass(r.status)}>
                        {r.status === "open_now"
                          ? "Open now"
                          : r.status === "opens_later"
                            ? "Opens later"
                            : "Fits window"}
                      </span>
                    </td>
                    <td className="mono">
                      {r.freeWindow.startLabel}–{r.freeWindow.endLabel}
                    </td>
                    <td>{r.nextClass ? `${r.nextClass.label} @ ${r.nextClass.startsAtLabel}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

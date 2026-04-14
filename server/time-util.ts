import type { DayCode } from "./meeting-model";

/** Default campus “day” for free-slot math: 08:00–22:00 local. */
export const DEFAULT_DAY_START_MIN = 8 * 60;
export const DEFAULT_DAY_END_MIN = 22 * 60;

export function parseTimeRange(timeStr: string): { startMin: number; endMin: number } | null {
  const t = timeStr.replace(/\s+/g, "").toLowerCase();
  if (!t || t === "tba" || t.includes("tba")) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})(a|p)-(\d{1,2}):(\d{2})(a|p)$/);
  if (!m) return null;
  const s = clockToMin(parseInt(m[1]!, 10), parseInt(m[2]!, 10), m[3]! as "a" | "p");
  const e = clockToMin(parseInt(m[4]!, 10), parseInt(m[5]!, 10), m[6]! as "a" | "p");
  if (s === null || e === null || e <= s) return null;
  return { startMin: s, endMin: e };
}

function clockToMin(hour: number, min: number, ap: "a" | "p"): number | null {
  if (min < 0 || min > 59 || hour < 1 || hour > 12) return null;
  if (ap === "a") {
    const h = hour === 12 ? 0 : hour;
    return h * 60 + min;
  }
  const h = hour === 12 ? 12 : hour + 12;
  return h * 60 + min;
}

/**
 * Expand SOC day column (e.g. "TuTh", "MWF", "M W F") to UCSD letter codes.
 * Tu→T (Tuesday), Th→R (Thursday), etc.
 */
export function parseDaysColumn(daysStr: string): DayCode[] {
  const compact = daysStr.replace(/\s+/g, "");
  if (!compact || /tba/i.test(compact)) return [];

  const out: DayCode[] = [];
  let i = 0;

  while (i < compact.length) {
    const rest = compact.slice(i);
    let step = 0;
    let code: DayCode | null = null;
    if (rest.startsWith("Tu")) {
      code = "T";
      step = 2;
    } else if (rest.startsWith("Th")) {
      code = "R";
      step = 2;
    } else if (rest.startsWith("Mo")) {
      code = "M";
      step = 2;
    } else if (rest.startsWith("We")) {
      code = "W";
      step = 2;
    } else if (rest.startsWith("Fr")) {
      code = "F";
      step = 2;
    } else if (rest.startsWith("Sa")) {
      code = "S";
      step = 2;
    } else {
      const c = rest[0]!;
      if (c === "M") code = "M";
      else if (c === "W") code = "W";
      else if (c === "F") code = "F";
      else if (c === "T") code = "T";
      else if (c === "R") code = "R";
      else if (c === "S") code = "S";
      step = 1;
    }
    if (!code) {
      i += 1;
      continue;
    }
    out.push(code);
    i += step;
  }

  return dedupeDays(out);
}

function dedupeDays(d: DayCode[]): DayCode[] {
  const seen = new Set<DayCode>();
  const o: DayCode[] = [];
  for (const x of d) {
    if (!seen.has(x)) {
      seen.add(x);
      o.push(x);
    }
  }
  return o;
}

/** Parse API day=Mo|Tu|We|Th|Fr|Sa|Su|M|T|W|R|F|S */
export function parseDayQuery(s: string): DayCode | null {
  const u = s.trim().toLowerCase();
  const map: Record<string, DayCode> = {
    mo: "M",
    mon: "M",
    monday: "M",
    tu: "T",
    tue: "T",
    tues: "T",
    tuesday: "T",
    we: "W",
    wed: "W",
    wednesday: "W",
    th: "R",
    thu: "R",
    thur: "R",
    thursday: "R",
    fr: "F",
    fri: "F",
    friday: "F",
    sa: "S",
    sat: "S",
    saturday: "S",
    m: "M",
    t: "T",
    w: "W",
    r: "R",
    f: "F",
    s: "S",
  };
  return map[u] ?? null;
}

export function formatMinutes(m: number): string {
  const h24 = Math.floor(m / 60) % 24;
  const min = m % 60;
  const ap = h24 >= 12 ? "p" : "a";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${min.toString().padStart(2, "0")}${ap}`;
}

export function parseClockToMin(s: string): number | null {
  const t = s.trim().toLowerCase();
  const m = t.match(/^(\d{1,2}):(\d{2})(a|p)$/);
  if (!m) return null;
  return clockToMin(parseInt(m[1]!, 10), parseInt(m[2]!, 10), m[3]! as "a" | "p");
}

/** Accepts HH:MM (24h) or h:mma/p. */
export function parseClockFlexible(s: string): number | null {
  const t = s.trim().toLowerCase();
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1]!, 10);
    const mi = parseInt(m24[2]!, 10);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  return parseClockToMin(t);
}

export type Interval = { startMin: number; endMin: number };

export function mergeIntervals(iv: Interval[]): Interval[] {
  if (!iv.length) return [];
  const s = [...iv].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Interval[] = [];
  let cur = { ...s[0]! };
  for (let i = 1; i < s.length; i++) {
    const n = s[i]!;
    if (n.startMin <= cur.endMin) cur.endMin = Math.max(cur.endMin, n.endMin);
    else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

/** Free gaps inside [windowStart, windowEnd] given merged busy intervals. */
export function freeIntervalsFromBusy(busyMerged: Interval[], windowStart: number, windowEnd: number): Interval[] {
  if (windowEnd <= windowStart) return [];
  const busy = mergeIntervals(busyMerged).filter((b) => b.endMin > windowStart && b.startMin < windowEnd);
  if (!busy.length) return [{ startMin: windowStart, endMin: windowEnd }];
  const free: Interval[] = [];
  let t = windowStart;
  for (const b of busy) {
    const bs = Math.max(b.startMin, windowStart);
    const be = Math.min(b.endMin, windowEnd);
    if (t < bs) free.push({ startMin: t, endMin: Math.min(bs, windowEnd) });
    t = Math.max(t, be);
  }
  if (t < windowEnd) free.push({ startMin: t, endMin: windowEnd });
  return mergeIntervals(free);
}

export function intervalDurationMin(iv: Interval): number {
  return Math.max(0, iv.endMin - iv.startMin);
}

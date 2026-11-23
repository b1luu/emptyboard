import type { DayCode, Interval, PacificNow } from "../types/schedule";

const TIME_RANGE_RE = /^(\d{1,2}):(\d{2})(am|pm|a|p)[-–](\d{1,2}):(\d{2})(am|pm|a|p)$/;
const CLOCK_12H_RE = /^(\d{1,2}):(\d{2})(am|pm|a|p)$/;
const CLOCK_24H_RE = /^(\d{1,2}):(\d{2})$/;

function clock12hToMinutes(hour: number, minute: number, meridiem: string): number | null {
  if (minute < 0 || minute > 59 || hour < 1 || hour > 12) return null;
  const isAm = meridiem === "a" || meridiem === "am";
  if (isAm) {
    const h24 = hour === 12 ? 0 : hour;
    return h24 * 60 + minute;
  }
  const h24 = hour === 12 ? 12 : hour + 12;
  return h24 * 60 + minute;
}

/** Parse SOC time range such as "3:30p-4:50p" or "10:00am-10:50am" into minute bounds. */
export function parseTimeRange(timeStr: string): Interval | null {
  if (typeof timeStr !== "string") return null;
  const compact = timeStr.replace(/\s+/g, "").toLowerCase();
  if (!compact || compact.includes("tba")) return null;

  const match = compact.match(TIME_RANGE_RE);
  if (!match) return null;

  const startMin = clock12hToMinutes(
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    match[3]!
  );
  const endMin = clock12hToMinutes(
    Number.parseInt(match[4]!, 10),
    Number.parseInt(match[5]!, 10),
    match[6]!
  );

  if (startMin === null || endMin === null || endMin <= startMin) return null;
  return { startMin, endMin };
}

/**
 * Strictly tokenize an SOC days column (e.g. "TuTh", "MWF", "M W F") into UCSD letter codes.
 * Any unrecognized token (e.g. "ARR", "TBD", "REMOTE", "Su") rejects the entire string and returns [].
 */
export function parseDaysColumn(daysStr: string): DayCode[] {
  if (typeof daysStr !== "string") return [];
  const compact = daysStr.replace(/\s+/g, "");
  if (!compact || /tba/i.test(compact)) return [];

  const parsed: DayCode[] = [];
  let index = 0;

  while (index < compact.length) {
    const rest = compact.slice(index);

    // Explicitly reject Sunday tokens rather than letting "S" match Saturday.
    if (rest.startsWith("Sun") || rest.startsWith("Su")) {
      return [];
    }

    if (rest.startsWith("Tu")) {
      parsed.push("T");
      index += 2;
    } else if (rest.startsWith("Th")) {
      parsed.push("R");
      index += 2;
    } else if (rest.startsWith("Mo")) {
      parsed.push("M");
      index += 2;
    } else if (rest.startsWith("We")) {
      parsed.push("W");
      index += 2;
    } else if (rest.startsWith("Fr")) {
      parsed.push("F");
      index += 2;
    } else if (rest.startsWith("Sa")) {
      parsed.push("S");
      index += 2;
    } else {
      const ch = rest[0];
      if (ch === "M" || ch === "T" || ch === "W" || ch === "R" || ch === "F" || ch === "S") {
        parsed.push(ch);
        index += 1;
      } else {
        return [];
      }
    }
  }

  return dedupeDays(parsed);
}

function dedupeDays(days: readonly DayCode[]): DayCode[] {
  const seen = new Set<DayCode>();
  const out: DayCode[] = [];
  for (const day of days) {
    if (!seen.has(day)) {
      seen.add(day);
      out.push(day);
    }
  }
  return out;
}

const DAY_QUERY_MAP: Record<string, DayCode> = {
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
  thurs: "R",
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

/** Parse API weekday query values (e.g. "Tu", "Tuesday", "R"). */
export function parseDayQuery(input: string): DayCode | null {
  const key = input.trim().toLowerCase();
  return Object.hasOwn(DAY_QUERY_MAP, key) ? DAY_QUERY_MAP[key]! : null;
}

export function formatMinutes(minutes: number): string {
  const normalized = ((Math.floor(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(normalized / 60);
  const min = normalized % 60;
  const ap = h24 >= 12 ? "p" : "a";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, "0")}${ap}`;
}

export function parseClockToMin(value: string): number | null {
  const compact = value.replace(/\s+/g, "").toLowerCase();
  const match = compact.match(CLOCK_12H_RE);
  if (!match) return null;
  return clock12hToMinutes(
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    match[3]!
  );
}

/** Accepts 24-hour HH:MM ("14:00", "24:00") or 12-hour clock ("2:00p", "2:00 pm"). */
export function parseClockFlexible(value: string): number | null {
  const compact = value.replace(/\s+/g, "").toLowerCase();
  const match24 = compact.match(CLOCK_24H_RE);
  if (match24) {
    const hour = Number.parseInt(match24[1]!, 10);
    const min = Number.parseInt(match24[2]!, 10);
    if (hour === 24 && min === 0) return 24 * 60;
    if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;
    return hour * 60 + min;
  }
  return parseClockToMin(compact);
}

export function parseTimeWindow(start: string | undefined, end: string | undefined): Interval | null {
  if (!start || !end) return null;
  const startMin = parseClockFlexible(start);
  const endMin = parseClockFlexible(end);
  if (startMin === null || endMin === null || endMin <= startMin) return null;
  return { startMin, endMin };
}

/**
 * Merge overlapping and touching back-to-back intervals in O(k log k) time.
 * Invalid intervals (non-finite or endMin <= startMin) are ignored.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const valid = intervals.filter(
    (iv) => Number.isFinite(iv.startMin) && Number.isFinite(iv.endMin) && iv.endMin > iv.startMin
  );
  if (!valid.length) return [];

  valid.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const merged: Interval[] = [];
  let current: Interval = { startMin: valid[0]!.startMin, endMin: valid[0]!.endMin };

  for (let i = 1; i < valid.length; i++) {
    const next = valid[i]!;
    if (next.startMin <= current.endMin) {
      if (next.endMin > current.endMin) current.endMin = next.endMin;
    } else {
      merged.push(current);
      current = { startMin: next.startMin, endMin: next.endMin };
    }
  }
  merged.push(current);
  return merged;
}

/**
 * Compute disjoint free gaps within [windowStart, windowEnd] by subtracting busy intervals.
 * Runs in O(k) when `alreadyMerged` is true, or O(k log k) otherwise.
 */
export function computeFreeIntervals(
  busyIntervals: readonly Interval[],
  windowStart: number,
  windowEnd: number,
  alreadyMerged = false
): Interval[] {
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) {
    return [];
  }

  const busy = alreadyMerged ? busyIntervals : mergeIntervals(busyIntervals);
  const free: Interval[] = [];
  let cursor = windowStart;

  for (const block of busy) {
    if (block.endMin <= windowStart) continue;
    if (block.startMin >= windowEnd) break;

    const clampedStart = Math.max(block.startMin, windowStart);
    const clampedEnd = Math.min(block.endMin, windowEnd);

    if (cursor < clampedStart) {
      free.push({ startMin: cursor, endMin: clampedStart });
    }
    if (clampedEnd > cursor) {
      cursor = clampedEnd;
    }
  }

  if (cursor < windowEnd) {
    free.push({ startMin: cursor, endMin: windowEnd });
  }

  return free;
}

const PACIFIC_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_TO_CODE: Record<string, DayCode> = {
  Mon: "M",
  Tue: "T",
  Wed: "W",
  Thu: "R",
  Fri: "F",
  Sat: "S",
};

/** Resolve wall-clock weekday and minutes in America/Los_Angeles. Sunday maps to day: null. */
export function nowPacific(date: Date = new Date()): PacificNow {
  const parts = PACIFIC_FORMATTER.formatToParts(date);
  const weekdayLabel = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = Number.parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return {
    day: WEEKDAY_TO_CODE[weekdayLabel] ?? null,
    minutes: hour * 60 + minute,
    weekdayLabel,
  };
}

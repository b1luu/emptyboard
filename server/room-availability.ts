import type { DayCode, Meeting } from "./meeting-model";
import { roomIdFromParts, roomKey } from "./meeting-model";
import type { SectionRow } from "./types";
import { sectionsToMeetings } from "./sections-to-meetings";
import {
  DEFAULT_DAY_END_MIN,
  DEFAULT_DAY_START_MIN,
  type Interval,
  formatMinutes,
  freeIntervalsFromBusy,
  mergeIntervals,
  parseClockFlexible,
} from "./time-util";

export type DaySchedule = {
  /** Merged occupied intervals (minutes). */
  busy: Interval[];
  /** Free gaps inside the configured daily window. */
  free: Interval[];
  /** Raw meetings that touch this day (for “next class” labels). */
  meetings: Meeting[];
};

export type RoomSchedule = {
  roomKey: string;
  roomId: string;
  building: string;
  room: string;
  byDay: Partial<Record<DayCode, DaySchedule>>;
};

export type RoomAvailabilityIndex = {
  term: string;
  dayStartMin: number;
  dayEndMin: number;
  rooms: Map<string, RoomSchedule>;
};

export function buildRoomAvailabilityIndex(
  term: string,
  sections: SectionRow[],
  opts?: { dayStartMin?: number; dayEndMin?: number }
): RoomAvailabilityIndex {
  const dayStartMin = opts?.dayStartMin ?? DEFAULT_DAY_START_MIN;
  const dayEndMin = opts?.dayEndMin ?? DEFAULT_DAY_END_MIN;
  const meetings = sectionsToMeetings(sections);
  const byRoom = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const k = roomKey(m.building, m.room);
    let arr = byRoom.get(k);
    if (!arr) {
      arr = [];
      byRoom.set(k, arr);
    }
    arr.push(m);
  }

  const rooms = new Map<string, RoomSchedule>();
  for (const [rk, ms] of byRoom) {
    const building = ms[0]!.building;
    const room = ms[0]!.room;
    const byDay: Partial<Record<DayCode, DaySchedule>> = {};
    const days: DayCode[] = ["M", "T", "W", "R", "F", "S"];
    for (const d of days) {
      const dayMeetings = ms.filter((x) => x.day === d);
      if (!dayMeetings.length) {
        byDay[d] = {
          busy: [],
          free: freeIntervalsFromBusy([], dayStartMin, dayEndMin),
          meetings: [],
        };
        continue;
      }
      const busyRaw: Interval[] = dayMeetings.map((m) => ({ startMin: m.startMin, endMin: m.endMin }));
      const busy = mergeIntervals(busyRaw);
      const free = freeIntervalsFromBusy(busy, dayStartMin, dayEndMin);
      byDay[d] = { busy, free, meetings: dayMeetings };
    }
    rooms.set(rk, {
      roomKey: rk,
      roomId: roomIdFromParts(building, room),
      building,
      room,
      byDay,
    });
  }

  return { term, dayStartMin, dayEndMin, rooms };
}

export type PacificNow = { day: DayCode | null; minutes: number; weekdayLabel: string };

/** Wall-clock in America/Los_Angeles for campus relevance. Sunday → day null (no letter code). */
export function nowPacific(): PacificNow {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const map: Record<string, DayCode> = {
    Mon: "M",
    Tue: "T",
    Wed: "W",
    Thu: "R",
    Fri: "F",
    Sat: "S",
  };
  const day = map[wd] ?? null;
  const minutes = hour * 60 + minute;
  return { day, minutes, weekdayLabel: wd };
}

function nextMeetingAfter(day: DaySchedule | undefined, afterMin: number): Meeting | null {
  if (!day?.meetings.length) return null;
  const sorted = [...day.meetings].sort((a, b) => a.startMin - b.startMin);
  for (const m of sorted) {
    if (m.startMin > afterMin) return m;
  }
  return null;
}

function meetingLabel(m: Meeting): string {
  return `${m.subject} ${m.courseNumber}`.trim();
}

export type RoomFreeNowRow = {
  building: string;
  room: string;
  roomId: string;
  status: "open_now" | "opens_later" | "closed";
  freeWindow: { startMin: number; endMin: number; startLabel: string; endLabel: string } | null;
  nextClass: { startsAtMin: number; startsAtLabel: string; label: string } | null;
};

export function roomsFreeNow(
  index: RoomAvailabilityIndex,
  opts: { buildingPrefix?: string; minFreeMin?: number }
): { now: PacificNow; rows: RoomFreeNowRow[]; campusDay: boolean } {
  const now = nowPacific();
  const minDur = opts.minFreeMin ?? 0;
  const bp = opts.buildingPrefix?.trim().toLowerCase() ?? "";
  const rows: RoomFreeNowRow[] = [];

  if (now.day === null) {
    return { now, rows, campusDay: false };
  }

  for (const r of index.rooms.values()) {
    if (bp && !r.building.toLowerCase().startsWith(bp) && !r.building.toLowerCase().includes(bp)) continue;

    const day = r.byDay[now.day];
    if (!day) continue;

    const freeSlots = minDur > 0 ? day.free.filter((f) => f.endMin - f.startMin >= minDur) : day.free;

    let status: RoomFreeNowRow["status"] = "closed";
    let freeWindow: RoomFreeNowRow["freeWindow"] = null;
    for (const f of freeSlots) {
      if (now.minutes >= f.startMin && now.minutes < f.endMin) {
        status = "open_now";
        freeWindow = {
          startMin: f.startMin,
          endMin: f.endMin,
          startLabel: formatMinutes(f.startMin),
          endLabel: formatMinutes(f.endMin),
        };
        break;
      }
    }
    if (status !== "open_now") {
      const upcoming = freeSlots.find((f) => f.startMin > now.minutes);
      if (upcoming) {
        status = "opens_later";
        freeWindow = {
          startMin: upcoming.startMin,
          endMin: upcoming.endMin,
          startLabel: formatMinutes(upcoming.startMin),
          endLabel: formatMinutes(upcoming.endMin),
        };
      }
    }

    const next = nextMeetingAfter(day, now.minutes);
    const nextClass = next
      ? { startsAtMin: next.startMin, startsAtLabel: formatMinutes(next.startMin), label: meetingLabel(next) }
      : null;

    if (status === "closed") continue;

    rows.push({
      building: r.building,
      room: r.room,
      roomId: r.roomId,
      status,
      freeWindow,
      nextClass,
    });
  }

  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "open_now" ? -1 : b.status === "open_now" ? 1 : 0;
    return `${a.building} ${a.room}`.localeCompare(`${b.building} ${b.room}`);
  });

  return { now, rows, campusDay: true };
}

export type RoomSearchRow = {
  building: string;
  room: string;
  roomId: string;
  freeWindow: { startMin: number; endMin: number; startLabel: string; endLabel: string };
  status: "open_now" | "opens_later" | "fits_window";
  nextClass: { startsAtMin: number; startsAtLabel: string; label: string } | null;
};

export function searchRoomsFreeInWindow(
  index: RoomAvailabilityIndex,
  opts: {
    day: DayCode;
    windowStart: number;
    windowEnd: number;
    buildingPrefix?: string;
    minFreeMin?: number;
    nowMinutes?: number;
    nowDay?: DayCode;
  }
): RoomSearchRow[] {
  const dayCode = opts.day;

  const bp = opts.buildingPrefix?.trim().toLowerCase() ?? "";
  const minDur = opts.minFreeMin ?? 0;
  const qStart = opts.windowStart;
  const qEnd = opts.windowEnd;
  if (qEnd <= qStart) return [];

  const nowM = opts.nowMinutes;
  const nowD = opts.nowDay;

  const out: RoomSearchRow[] = [];

  for (const r of index.rooms.values()) {
    if (bp && !r.building.toLowerCase().startsWith(bp) && !r.building.toLowerCase().includes(bp)) continue;

    const day = r.byDay[dayCode];
    if (!day) continue;

    const candidates = day.free.filter((f) => {
      if (f.endMin - f.startMin < minDur) return false;
      return f.startMin <= qStart && f.endMin >= qEnd;
    });

    if (!candidates.length) continue;

    const best = candidates.reduce((a, b) => (a.endMin - a.startMin >= b.endMin - b.startMin ? a : b));

    let status: RoomSearchRow["status"] = "fits_window";
    if (nowM !== undefined && nowD === dayCode) {
      if (nowM >= best.startMin && nowM < best.endMin) status = "open_now";
      else if (nowM < best.startMin) status = "opens_later";
    }

    const next = nextMeetingAfter(day, Math.max(nowM ?? qStart, qEnd));
    const nextClass = next
      ? { startsAtMin: next.startMin, startsAtLabel: formatMinutes(next.startMin), label: meetingLabel(next) }
      : null;

    out.push({
      building: r.building,
      room: r.room,
      roomId: r.roomId,
      freeWindow: {
        startMin: best.startMin,
        endMin: best.endMin,
        startLabel: formatMinutes(best.startMin),
        endLabel: formatMinutes(best.endMin),
      },
      status,
      nextClass,
    });
  }

  out.sort((a, b) => `${a.building} ${a.room}`.localeCompare(`${b.building} ${b.room}`));
  return out;
}

export function getRoomAvailabilityDetail(
  index: RoomAvailabilityIndex,
  building: string,
  room: string
): RoomSchedule | null {
  const k = roomKey(building, room);
  return index.rooms.get(k) ?? null;
}

/** Parse start/end query params for search. */
export function parseWindowFromQuery(start: string | undefined, end: string | undefined): { start: number; end: number } | null {
  if (!start || !end) return null;
  const a = parseClockFlexible(start);
  const b = parseClockFlexible(end);
  if (a === null || b === null || b <= a) return null;
  return { start: a, end: b };
}

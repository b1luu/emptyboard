import { DEFAULT_DAY_END_MIN, DEFAULT_DAY_START_MIN } from "../config";
import {
  ALL_DAY_CODES,
  roomIdFromParts,
  roomKey,
  type DayCode,
  type DaySchedule,
  type FormattedInterval,
  type Interval,
  type Meeting,
  type NextClassInfo,
  type PacificNow,
  type RoomAvailabilityIndex,
  type RoomFreeNowRow,
  type RoomSchedule,
  type RoomSearchRow,
  type SectionRow,
} from "../types/schedule";
import {
  computeFreeIntervals,
  formatMinutes,
  mergeIntervals,
  nowPacific,
  parseDaysColumn,
  parseTimeRange,
} from "./time-window";

const SKIP_BUILDING_RE = /\b(tba|tbd|online|remote|zoom|web|rclas)\b/i;
const SKIP_ROOM_RE = /\b(tba|tbd|remote|online)\b/i;

function normalizeSpaces(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Normalize raw SOC section rows into concrete physical room meetings. */
export function sectionsToMeetings(rows: readonly SectionRow[]): Meeting[] {
  const meetings: Meeting[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    const building = normalizeSpaces(row.building);
    const room = normalizeSpaces(row.room);
    if (!building || !room) continue;
    if (SKIP_BUILDING_RE.test(building) || SKIP_ROOM_RE.test(room)) continue;

    const timeRange = parseTimeRange(row.time);
    if (!timeRange) continue;

    const days = parseDaysColumn(row.days);
    if (!days.length) continue;

    const term = normalizeSpaces(row.term);
    const subject = normalizeSpaces(row.subject);
    const courseNumber = normalizeSpaces(row.courseNumber);
    const courseTitle = normalizeSpaces(row.courseTitle);

    for (const day of days) {
      meetings.push({
        term,
        subject,
        courseNumber,
        courseTitle,
        building,
        room,
        day,
        startMin: timeRange.startMin,
        endMin: timeRange.endMin,
      });
    }
  }

  return meetings;
}

/**
 * Build an in-memory per-room availability index.
 * Pre-merges busy intervals, precomputes daily free windows, and pre-sorts
 * meetings per room-day so hot-path queries avoid per-request sorting.
 */
export function buildRoomAvailabilityIndex(
  term: string,
  sections: readonly SectionRow[],
  opts?: { dayStartMin?: number; dayEndMin?: number }
): RoomAvailabilityIndex {
  const t0 = performance.now();
  const dayStartMin = opts?.dayStartMin ?? DEFAULT_DAY_START_MIN;
  const dayEndMin = opts?.dayEndMin ?? DEFAULT_DAY_END_MIN;

  const meetings = sectionsToMeetings(sections);

  type RoomBucket = {
    building: string;
    room: string;
    byDay: Record<DayCode, Meeting[]>;
  };

  const buckets = new Map<string, RoomBucket>();
  for (const m of meetings) {
    const key = roomKey(m.building, m.room);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        building: m.building,
        room: m.room,
        byDay: { M: [], T: [], W: [], R: [], F: [], S: [] },
      };
      buckets.set(key, bucket);
    }
    bucket.byDay[m.day].push(m);
  }

  const fullDayFree = computeFreeIntervals([], dayStartMin, dayEndMin, true);
  const rooms = new Map<string, RoomSchedule>();

  for (const [rk, bucket] of buckets) {
    const byDay = {} as Record<DayCode, DaySchedule>;

    for (const day of ALL_DAY_CODES) {
      const dayMeetings = bucket.byDay[day];
      if (!dayMeetings.length) {
        byDay[day] = {
          busy: [],
          free: fullDayFree,
          meetings: [],
        };
        continue;
      }

      dayMeetings.sort(
        (a, b) =>
          a.startMin - b.startMin ||
          a.endMin - b.endMin ||
          a.subject.localeCompare(b.subject) ||
          a.courseNumber.localeCompare(b.courseNumber)
      );

      const busyRaw: Interval[] = dayMeetings.map((m) => ({
        startMin: m.startMin,
        endMin: m.endMin,
      }));
      const busy = mergeIntervals(busyRaw);
      const free = computeFreeIntervals(busy, dayStartMin, dayEndMin, true);

      byDay[day] = { busy, free, meetings: dayMeetings };
    }

    rooms.set(rk, {
      roomKey: rk,
      roomId: roomIdFromParts(bucket.building, bucket.room),
      building: bucket.building,
      room: bucket.room,
      byDay,
    });
  }

  return {
    term,
    dayStartMin,
    dayEndMin,
    sectionCount: sections.length,
    meetingCount: meetings.length,
    roomCount: rooms.size,
    buildTimeMs: performance.now() - t0,
    rooms,
  };
}

/** Binary search on pre-sorted meetings for the first class starting at or after `minMinute`. */
export function findNextMeetingAtOrAfter(
  sortedMeetings: readonly Meeting[],
  minMinute: number
): Meeting | null {
  let lo = 0;
  let hi = sortedMeetings.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedMeetings[mid]!.startMin < minMinute) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return lo < sortedMeetings.length ? sortedMeetings[lo]! : null;
}

function toFormattedInterval(iv: Interval): FormattedInterval {
  return {
    startMin: iv.startMin,
    endMin: iv.endMin,
    startLabel: formatMinutes(iv.startMin),
    endLabel: formatMinutes(iv.endMin),
  };
}

function toNextClassInfo(meeting: Meeting | null): NextClassInfo | null {
  if (!meeting) return null;
  return {
    startsAtMin: meeting.startMin,
    startsAtLabel: formatMinutes(meeting.startMin),
    label: `${meeting.subject} ${meeting.courseNumber}`.trim(),
  };
}

export function findRoomsFreeNow(
  index: RoomAvailabilityIndex,
  opts: { buildingFilter?: string; minFreeMin?: number; now?: PacificNow } = {}
): { now: PacificNow; rows: RoomFreeNowRow[]; campusDay: boolean } {
  const now = opts.now ?? nowPacific();
  const minDur = Math.max(0, opts.minFreeMin ?? 0);
  const buildingQuery = opts.buildingFilter?.trim().toLowerCase() ?? "";
  const rows: RoomFreeNowRow[] = [];

  if (now.day === null) {
    return { now, rows, campusDay: false };
  }

  for (const room of index.rooms.values()) {
    if (buildingQuery && !room.building.toLowerCase().includes(buildingQuery)) continue;

    const day = room.byDay[now.day];
    let status: RoomFreeNowRow["status"] = "closed";
    let matchedSlot: Interval | null = null;

    // 1. Open right now with at least `minDur` minutes remaining from `now.minutes`.
    for (const slot of day.free) {
      if (now.minutes >= slot.startMin && now.minutes < slot.endMin) {
        if (slot.endMin - now.minutes >= minDur) {
          status = "open_now";
          matchedSlot = slot;
        }
        break;
      }
    }

    // 2. Otherwise find the earliest upcoming free slot meeting `minDur`.
    if (status !== "open_now") {
      for (const slot of day.free) {
        if (slot.startMin > now.minutes && slot.endMin - slot.startMin >= minDur) {
          status = "opens_later";
          matchedSlot = slot;
          break;
        }
      }
    }

    if (status === "closed" || !matchedSlot) continue;

    const nextMeeting = findNextMeetingAtOrAfter(day.meetings, matchedSlot.endMin);

    rows.push({
      building: room.building,
      room: room.room,
      roomId: room.roomId,
      status,
      freeWindow: toFormattedInterval(matchedSlot),
      nextClass: toNextClassInfo(nextMeeting),
    });
  }

  rows.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "open_now" ? -1 : b.status === "open_now" ? 1 : 0;
    }
    return `${a.building} ${a.room}`.localeCompare(`${b.building} ${b.room}`);
  });

  return { now, rows, campusDay: true };
}

export function searchRoomsInWindow(
  index: RoomAvailabilityIndex,
  opts: {
    day: DayCode;
    windowStart: number;
    windowEnd: number;
    buildingFilter?: string;
    minFreeMin?: number;
    nowMinutes?: number;
    nowDay?: DayCode;
  }
): RoomSearchRow[] {
  const { day: dayCode, windowStart: qStart, windowEnd: qEnd, nowMinutes, nowDay } = opts;
  if (qEnd <= qStart) return [];

  const buildingQuery = opts.buildingFilter?.trim().toLowerCase() ?? "";
  const minDur = Math.max(0, opts.minFreeMin ?? 0);
  const out: RoomSearchRow[] = [];

  for (const room of index.rooms.values()) {
    if (buildingQuery && !room.building.toLowerCase().includes(buildingQuery)) continue;

    const day = room.byDay[dayCode];
    let matchedSlot: Interval | null = null;

    // Free slots are disjoint, so at most one slot can contain [qStart, qEnd].
    for (const slot of day.free) {
      if (slot.startMin <= qStart && slot.endMin >= qEnd) {
        if (slot.endMin - slot.startMin >= minDur) {
          matchedSlot = slot;
        }
        break;
      }
    }

    if (!matchedSlot) continue;

    let status: RoomSearchRow["status"] = "fits_window";
    if (nowMinutes !== undefined && nowDay === dayCode) {
      if (nowMinutes >= matchedSlot.startMin && nowMinutes < matchedSlot.endMin) {
        status = "open_now";
      } else if (nowMinutes < matchedSlot.startMin) {
        status = "opens_later";
      }
    }

    const nextMeeting = findNextMeetingAtOrAfter(day.meetings, matchedSlot.endMin);

    out.push({
      building: room.building,
      room: room.room,
      roomId: room.roomId,
      freeWindow: toFormattedInterval(matchedSlot),
      status,
      nextClass: toNextClassInfo(nextMeeting),
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
  return index.rooms.get(roomKey(building, room)) ?? null;
}

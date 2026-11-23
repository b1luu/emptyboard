/** UCSD weekday codes (M=Mon, T=Tue, W=Wed, R=Thu, F=Fri, S=Sat). */
export type DayCode = "M" | "T" | "W" | "R" | "F" | "S";

export const ALL_DAY_CODES: readonly DayCode[] = ["M", "T", "W", "R", "F", "S"] as const;

export type Interval = {
  /** Minutes from local midnight [0, 1440]. */
  startMin: number;
  endMin: number;
};

export type FormattedInterval = Interval & {
  startLabel: string;
  endLabel: string;
};

export type SectionRow = {
  term: string;
  subject: string;
  subjectName?: string;
  courseNumber: string;
  courseTitle: string;
  sectionId: string;
  meetingType: string;
  section: string;
  days: string;
  time: string;
  building: string;
  room: string;
  instructor: string;
  available: string;
  limit: string;
};

export type TermMeta = {
  code: string;
  label: string;
};

export type Meeting = {
  term: string;
  subject: string;
  courseNumber: string;
  courseTitle: string;
  building: string;
  room: string;
  day: DayCode;
  /** Minutes from local midnight [0, 1440). */
  startMin: number;
  endMin: number;
};

export type DaySchedule = {
  /** Merged occupied intervals sorted ascending by startMin. */
  busy: Interval[];
  /** Disjoint free gaps inside the configured daily window, sorted ascending. */
  free: Interval[];
  /** Meetings occurring on this day, pre-sorted ascending by startMin then endMin. */
  meetings: Meeting[];
};

export type RoomSchedule = {
  roomKey: string;
  roomId: string;
  building: string;
  room: string;
  byDay: Record<DayCode, DaySchedule>;
};

export type RoomAvailabilityIndex = {
  term: string;
  dayStartMin: number;
  dayEndMin: number;
  sectionCount: number;
  meetingCount: number;
  roomCount: number;
  buildTimeMs: number;
  rooms: Map<string, RoomSchedule>;
};

export type PacificNow = {
  day: DayCode | null;
  minutes: number;
  weekdayLabel: string;
};

export type NextClassInfo = {
  startsAtMin: number;
  startsAtLabel: string;
  label: string;
};

export type RoomFreeNowRow = {
  building: string;
  room: string;
  roomId: string;
  status: "open_now" | "opens_later" | "closed";
  freeWindow: FormattedInterval | null;
  nextClass: NextClassInfo | null;
};

export type RoomSearchRow = {
  building: string;
  room: string;
  roomId: string;
  freeWindow: FormattedInterval;
  status: "open_now" | "opens_later" | "fits_window";
  nextClass: NextClassInfo | null;
};

export type LoadedTermData = {
  term: string;
  sections: SectionRow[];
  loadedAt: number;
  sourcePath: string;
};

export type TermsSource = "live" | "cache" | "stale-cache" | "disk-fallback";

export type TermsResult = {
  terms: TermMeta[];
  source: TermsSource;
  fetchedAt: number;
};

export type SyncSummary = {
  term: string;
  subjectsRequested: number;
  subjectsSucceeded: number;
  failedSubjects: string[];
  sectionCount: number;
  durationMs: number;
  sourcePath: string;
};

/** Stable opaque identifier used in room detail URL paths. */
export function roomIdFromParts(building: string, room: string): string {
  const b = building.trim();
  const r = room.trim();
  return Buffer.from(`${b}\x1e${r}`, "utf8").toString("base64url");
}

export function partsFromRoomId(id: string): { building: string; room: string } | null {
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  try {
    const decoded = Buffer.from(id, "base64url").toString("utf8");
    const sep = decoded.indexOf("\x1e");
    if (sep <= 0) return null;
    if (decoded.indexOf("\x1e", sep + 1) !== -1) return null;
    const building = decoded.slice(0, sep).trim();
    const room = decoded.slice(sep + 1).trim();
    if (!building || !room) return null;
    return { building, room };
  } catch {
    return null;
  }
}

export function roomKey(building: string, room: string): string {
  return `${building.trim().toUpperCase()}\x1e${room.trim().toUpperCase()}`;
}

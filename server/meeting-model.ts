/** UCSD-style weekday codes (M T W R F S — T=Tuesday, R=Thursday). */
export type DayCode = "M" | "T" | "W" | "R" | "F" | "S";

export type Meeting = {
  term: string;
  subject: string;
  courseNumber: string;
  courseTitle: string;
  building: string;
  room: string;
  day: DayCode;
  /** Minutes from local midnight [0, 24*60). */
  startMin: number;
  endMin: number;
};

/** Stable id for URL paths (opaque). */
export function roomIdFromParts(building: string, room: string): string {
  const b = building.trim();
  const r = room.trim();
  return Buffer.from(`${b}\x1e${r}`, "utf8").toString("base64url");
}

export function partsFromRoomId(id: string): { building: string; room: string } | null {
  try {
    const s = Buffer.from(id, "base64url").toString("utf8");
    const i = s.indexOf("\x1e");
    if (i < 0) return null;
    return { building: s.slice(0, i), room: s.slice(i + 1) };
  } catch {
    return null;
  }
}

export function roomKey(building: string, room: string): string {
  return `${building.trim().toUpperCase()}\x1e${room.trim().toUpperCase()}`;
}

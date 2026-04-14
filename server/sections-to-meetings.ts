import type { Meeting } from "./meeting-model";
import type { SectionRow } from "./types";
import { parseDaysColumn, parseTimeRange } from "./time-util";

const SKIP_BUILDING = /\b(tba|tbd|online|remote|zoom|web)\b/i;
const SKIP_ROOM = /\b(tba|tbd|remote|online)\b/i;

export function sectionsToMeetings(rows: SectionRow[]): Meeting[] {
  const out: Meeting[] = [];
  for (const r of rows) {
    const building = r.building.replace(/\s+/g, " ").trim();
    const room = r.room.replace(/\s+/g, " ").trim();
    if (!building || !room) continue;
    if (SKIP_BUILDING.test(building) || SKIP_ROOM.test(room)) continue;

    const tr = parseTimeRange(r.time);
    if (!tr) continue;

    const days = parseDaysColumn(r.days);
    if (!days.length) continue;

    for (const day of days) {
      out.push({
        term: r.term,
        subject: r.subject.trim(),
        courseNumber: r.courseNumber.trim(),
        courseTitle: r.courseTitle.trim(),
        building,
        room,
        day,
        startMin: tr.startMin,
        endMin: tr.endMin,
      });
    }
  }
  return out;
}

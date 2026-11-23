import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRoomAvailabilityIndex,
  findNextMeetingAtOrAfter,
  findRoomsFreeNow,
  getRoomAvailabilityDetail,
  searchRoomsInWindow,
  sectionsToMeetings,
} from "../server/services/availability";
import {
  computeFreeIntervals,
  formatMinutes,
  mergeIntervals,
  nowPacific,
  parseClockFlexible,
  parseClockToMin,
  parseDayQuery,
  parseDaysColumn,
  parseTimeRange,
  parseTimeWindow,
} from "../server/services/time-window";
import type { SectionRow } from "../server/types/schedule";

function makeSection(overrides: Partial<SectionRow> = {}): SectionRow {
  return {
    term: "SP26",
    subject: "CSE",
    courseNumber: "100",
    courseTitle: "Advanced Data Structures",
    sectionId: "100001",
    meetingType: "LE",
    section: "A00",
    days: "TuTh",
    time: "10:00a-10:50a",
    building: "CENTR",
    room: "109",
    instructor: "Staff",
    available: "10",
    limit: "100",
    ...overrides,
  };
}

describe("time-window parsing helpers", () => {
  it("parses valid 12-hour SOC time ranges including am/pm, noon, midnight, and en-dash", () => {
    assert.deepEqual(parseTimeRange("8:00a-8:50a"), { startMin: 480, endMin: 530 });
    assert.deepEqual(parseTimeRange("12:00a-12:50a"), { startMin: 0, endMin: 50 });
    assert.deepEqual(parseTimeRange("11:00a-1:00p"), { startMin: 660, endMin: 780 });
    assert.deepEqual(parseTimeRange("12:00pm–1:20pm"), { startMin: 720, endMin: 800 });
    assert.deepEqual(parseTimeRange(" 3:30p - 4:50p "), { startMin: 930, endMin: 1010 });
  });

  it("rejects TBA, inverted, equal, out-of-range, and malformed time ranges", () => {
    assert.equal(parseTimeRange(""), null);
    assert.equal(parseTimeRange("TBA"), null);
    assert.equal(parseTimeRange("4:00p-2:00p"), null);
    assert.equal(parseTimeRange("2:00p-2:00p"), null);
    assert.equal(parseTimeRange("13:00p-2:00p"), null);
    assert.equal(parseTimeRange("10:60a-11:00a"), null);
    assert.equal(parseTimeRange("0:30a-1:00a"), null);
    assert.equal(parseTimeRange("invalid"), null);
    assert.equal(parseTimeRange(null as unknown as string), null);
  });

  it("strictly tokenizes valid SOC day columns and rejects stray-character garbage", () => {
    assert.deepEqual(parseDaysColumn("MWF"), ["M", "W", "F"]);
    assert.deepEqual(parseDaysColumn("TuTh"), ["T", "R"]);
    assert.deepEqual(parseDaysColumn("M W F"), ["M", "W", "F"]);
    assert.deepEqual(parseDaysColumn("MoWeFrSa"), ["M", "W", "F", "S"]);
    assert.deepEqual(parseDaysColumn("MMWF"), ["M", "W", "F"]);

    // Garbage & Sunday tokens must reject entirely instead of extracting stray letters
    assert.deepEqual(parseDaysColumn(""), []);
    assert.deepEqual(parseDaysColumn("TBA"), []);
    assert.deepEqual(parseDaysColumn("ARR"), []);
    assert.deepEqual(parseDaysColumn("TBD"), []);
    assert.deepEqual(parseDaysColumn("REMOTE"), []);
    assert.deepEqual(parseDaysColumn("STAFF"), []);
    assert.deepEqual(parseDaysColumn("ONLINE"), []);
    assert.deepEqual(parseDaysColumn("Su"), []);
    assert.deepEqual(parseDaysColumn("Sun"), []);
    assert.deepEqual(parseDaysColumn("MSu"), []);
    assert.deepEqual(parseDaysColumn(undefined as unknown as string), []);
  });

  it("parses API day queries safely and blocks Object.prototype lookups", () => {
    assert.equal(parseDayQuery("Tu"), "T");
    assert.equal(parseDayQuery("thursday"), "R");
    assert.equal(parseDayQuery(" sat "), "S");
    assert.equal(parseDayQuery("Sun"), null);
    assert.equal(parseDayQuery("constructor"), null);
    assert.equal(parseDayQuery("__proto__"), null);
    assert.equal(parseDayQuery("toString"), null);
  });

  it("parses flexible 24h and 12h clock times and formats minutes cleanly", () => {
    assert.equal(parseClockFlexible("08:00"), 480);
    assert.equal(parseClockFlexible("14:30"), 870);
    assert.equal(parseClockFlexible("24:00"), 1440);
    assert.equal(parseClockFlexible("2:00p"), 840);
    assert.equal(parseClockFlexible("2:00 pm"), 840);
    assert.equal(parseClockToMin("12:00a"), 0);
    assert.equal(parseClockToMin("12:00p"), 720);

    assert.equal(parseClockFlexible("24:01"), null);
    assert.equal(parseClockFlexible("25:00"), null);
    assert.equal(parseClockFlexible("12:60"), null);
    assert.equal(parseTimeWindow("15:00", "14:00"), null);
    assert.equal(parseTimeWindow("14:00", "14:00"), null);
    assert.deepEqual(parseTimeWindow("14:00", "15:30"), { startMin: 840, endMin: 930 });

    assert.equal(formatMinutes(0), "12:00a");
    assert.equal(formatMinutes(480), "8:00a");
    assert.equal(formatMinutes(720), "12:00p");
    assert.equal(formatMinutes(1320), "10:00p");
  });

  it("resolves Pacific wall-clock day and minutes deterministically across PDT, PST, and midnight", () => {
    // 2026-04-14T21:30:00Z is Tue 14:30 PDT (UTC-7)
    assert.deepEqual(nowPacific(new Date("2026-04-14T21:30:00Z")), {
      day: "T",
      minutes: 14 * 60 + 30,
      weekdayLabel: "Tue",
    });
    // 2026-01-15T18:15:00Z is Thu 10:15 PST (UTC-8)
    assert.deepEqual(nowPacific(new Date("2026-01-15T18:15:00Z")), {
      day: "R",
      minutes: 10 * 60 + 15,
      weekdayLabel: "Thu",
    });
    // 2026-01-16T08:00:00Z is Fri 00:00 PST (midnight -> minutes: 0, verifies h23)
    assert.deepEqual(nowPacific(new Date("2026-01-16T08:00:00Z")), {
      day: "F",
      minutes: 0,
      weekdayLabel: "Fri",
    });
    // 2026-04-19T19:00:00Z is Sun 12:00 PDT -> day: null
    assert.deepEqual(nowPacific(new Date("2026-04-19T19:00:00Z")), {
      day: null,
      minutes: 12 * 60,
      weekdayLabel: "Sun",
    });
  });
});

describe("interval merging and free-window subtraction", () => {
  it("merges overlapping, nested, unsorted, duplicate, and back-to-back intervals", () => {
    const merged = mergeIntervals([
      { startMin: 700, endMin: 760 },
      { startMin: 600, endMin: 650 },
      { startMin: 650, endMin: 700 }, // back-to-back touching 600-650 and 700-760
      { startMin: 610, endMin: 640 }, // strictly nested
      { startMin: 600, endMin: 650 }, // exact duplicate
      { startMin: 900, endMin: 950 },
      { startMin: 920, endMin: 1000 }, // partial overlap
      { startMin: 800, endMin: 800 }, // zero-length invalid -> ignored
      { startMin: 850, endMin: 810 }, // inverted invalid -> ignored
      { startMin: Number.NaN, endMin: 900 }, // non-finite -> ignored
    ]);

    assert.deepEqual(merged, [
      { startMin: 600, endMin: 760 },
      { startMin: 900, endMin: 1000 },
    ]);
  });

  it("subtracts busy blocks across boundary minutes cleanly", () => {
    // Full free day when empty
    assert.deepEqual(computeFreeIntervals([], 480, 1320), [{ startMin: 480, endMin: 1320 }]);

    // Classes before window, straddling start/end, and after window
    const free = computeFreeIntervals(
      [
        { startMin: 360, endMin: 480 }, // ends exactly at window start
        { startMin: 450, endMin: 540 }, // straddles start -> busy until 9:00a
        { startMin: 600, endMin: 660 }, // 10:00a-11:00a
        { startMin: 660, endMin: 720 }, // back-to-back 11:00a-12:00p
        { startMin: 1260, endMin: 1380 }, // straddles end -> busy from 9:00p
        { startMin: 1380, endMin: 1420 }, // entirely after window
      ],
      480,
      1320
    );
    assert.deepEqual(free, [
      { startMin: 540, endMin: 600 },
      { startMin: 720, endMin: 1260 },
    ]);

    // Fully occupied day yields no free slots
    assert.deepEqual(computeFreeIntervals([{ startMin: 420, endMin: 1380 }], 480, 1320), []);

    // Invalid/empty daily window yields no free slots
    assert.deepEqual(computeFreeIntervals([], 1320, 480), []);
    assert.deepEqual(computeFreeIntervals([], 600, 600), []);
  });
});

describe("room availability indexing and queries", () => {
  it("normalizes sections into meetings and skips TBA, remote, and malformed rows", () => {
    const meetings = sectionsToMeetings([
      makeSection({ days: "TuTh", time: "10:00a-10:50a", building: "CENTR", room: "109" }),
      makeSection({ building: "RCLAS", room: "R10" }),
      makeSection({ building: "ONLINE", room: "100" }),
      makeSection({ building: "CENTR", room: "TBA" }),
      makeSection({ days: "ARR" }),
      makeSection({ time: "TBA" }),
      makeSection({ building: "", room: "109" }),
      null as unknown as SectionRow,
    ]);

    assert.equal(meetings.length, 2);
    assert.deepEqual(
      meetings.map((m) => m.day),
      ["T", "R"]
    );
  });

  it("pre-sorts meetings and finds exact-boundary next classes in O(log k)", () => {
    const index = buildRoomAvailabilityIndex("SP26", [
      makeSection({ courseNumber: "101", days: "Tu", time: "3:00p-4:00p" }),
      makeSection({ courseNumber: "100", days: "Tu", time: "12:00p-1:00p" }),
      makeSection({ courseNumber: "105", days: "Tu", time: "12:00p-1:00p" }),
    ]);

    const detail = getRoomAvailabilityDetail(index, "centr", "109");
    assert.ok(detail);
    assert.deepEqual(
      detail.byDay.T.meetings.map((m) => `${m.courseNumber}@${m.startMin}`),
      ["100@720", "105@720", "101@900"]
    );

    // Exact boundary 900 (3:00p) must match CSE 101
    assert.equal(findNextMeetingAtOrAfter(detail.byDay.T.meetings, 900)?.courseNumber, "101");
    assert.equal(findNextMeetingAtOrAfter(detail.byDay.T.meetings, 901), null);
  });

  it("enforces remaining-time minFreeMin, boundary equalities, and Sunday handling in findRoomsFreeNow", () => {
    const index = buildRoomAvailabilityIndex("SP26", [
      makeSection({
        building: "CENTR",
        room: "109",
        courseNumber: "100",
        days: "Tu",
        time: "12:00p-1:00p",
      }),
      makeSection({
        building: "CENTR",
        room: "109",
        courseNumber: "101",
        days: "Tu",
        time: "3:00p-4:00p",
      }),
      makeSection({
        building: "CSE",
        room: "120",
        courseNumber: "110",
        days: "Tu",
        time: "8:00a-10:00p",
      }),
    ]);

    // At 11:55a (715), CENTR 109 has 5 min left -> fails minFreeMin=30 -> opens_later (1:00p-3:00p)
    const freeNow = findRoomsFreeNow(index, {
      minFreeMin: 30,
      now: { day: "T", minutes: 715, weekdayLabel: "Tue" },
    });
    assert.equal(freeNow.campusDay, true);
    assert.equal(freeNow.rows.length, 1);
    assert.equal(freeNow.rows[0]!.building, "CENTR");
    assert.equal(freeNow.rows[0]!.status, "opens_later");
    assert.deepEqual(freeNow.rows[0]!.freeWindow, {
      startMin: 780,
      endMin: 900,
      startLabel: "1:00p",
      endLabel: "3:00p",
    });
    assert.deepEqual(freeNow.rows[0]!.nextClass, {
      startsAtMin: 900,
      startsAtLabel: "3:00p",
      label: "CSE 101",
    });

    // Exact boundary equalities: now === slot.startMin (780) -> open_now; exact remaining === minFreeMin (870 + 30 === 900) -> open_now
    assert.equal(
      findRoomsFreeNow(index, { minFreeMin: 120, now: { day: "T", minutes: 780, weekdayLabel: "Tue" } }).rows[0]!.status,
      "open_now"
    );
    assert.equal(
      findRoomsFreeNow(index, { minFreeMin: 30, now: { day: "T", minutes: 870, weekdayLabel: "Tue" } }).rows[0]!.status,
      "open_now"
    );
    // Exact boundary now === slot.endMin (900, class starts at 3:00p) -> opens_later at 4:00p (960)
    const atEnd = findRoomsFreeNow(index, { now: { day: "T", minutes: 900, weekdayLabel: "Tue" } });
    assert.equal(atEnd.rows[0]!.status, "opens_later");
    assert.equal(atEnd.rows[0]!.freeWindow?.startMin, 960);

    // Sunday -> campusDay: false, empty rows
    const sunday = findRoomsFreeNow(index, {
      now: { day: null, minutes: 600, weekdayLabel: "Sun" },
    });
    assert.equal(sunday.campusDay, false);
    assert.deepEqual(sunday.rows, []);
  });

  it("matches exact containment windows, minFreeMin, and status tagging in searchRoomsInWindow", () => {
    const index = buildRoomAvailabilityIndex("SP26", [
      makeSection({ building: "CENTR", room: "109", courseNumber: "100", days: "Tu", time: "12:00p-1:00p" }),
      makeSection({ building: "CENTR", room: "109", courseNumber: "101", days: "Tu", time: "3:00p-4:00p" }),
      makeSection({ building: "PETER", room: "108", courseNumber: "20C", subject: "MATH", days: "Tu", time: "2:00p-2:50p" }),
    ]);

    // Window 2:00p-3:00p (840-900) fits CENTR 109 (free 1:00p-3:00p, 120 min) with open_now status
    const openNow = searchRoomsInWindow(index, {
      day: "T",
      windowStart: 840,
      windowEnd: 900,
      nowDay: "T",
      nowMinutes: 800,
    });
    assert.equal(openNow.length, 1);
    assert.equal(openNow[0]!.building, "CENTR");
    assert.equal(openNow[0]!.status, "open_now");
    assert.equal(openNow[0]!.nextClass?.startsAtMin, 900);
    assert.equal(openNow[0]!.nextClass?.label, "CSE 101");

    // Status tagging: opens_later (before slot start) and fits_window (different day)
    assert.equal(
      searchRoomsInWindow(index, { day: "T", windowStart: 840, windowEnd: 900, nowDay: "T", nowMinutes: 720 })[0]!.status,
      "opens_later"
    );
    assert.equal(
      searchRoomsInWindow(index, { day: "T", windowStart: 840, windowEnd: 900, nowDay: "W", nowMinutes: 800 })[0]!.status,
      "fits_window"
    );

    // minFreeMin filters out containing slot whose total duration (120 min) is below requested 150 min
    assert.equal(
      searchRoomsInWindow(index, { day: "T", windowStart: 840, windowEnd: 900, minFreeMin: 150 }).length,
      0
    );

    // Building filter & inverted window checks
    assert.equal(
      searchRoomsInWindow(index, { day: "T", windowStart: 840, windowEnd: 900, buildingFilter: "peter" }).length,
      0
    );
    assert.equal(
      searchRoomsInWindow(index, { day: "T", windowStart: 900, windowEnd: 840 }).length,
      0
    );
  });
});

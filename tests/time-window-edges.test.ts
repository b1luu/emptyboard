import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeFreeIntervals,
  mergeIntervals,
  nowPacific,
  parseClockFlexible,
  parseClockToMin,
  parseDayQuery,
  parseDaysColumn,
  parseTimeRange,
  parseTimeWindow,
} from "../server/services/time-window";

describe("time-window edge behavior (mutation-driven)", () => {
  it("accepts am/pm long meridiems and boundary minutes/hours in clock parsing", () => {
    assert.deepEqual(parseTimeRange("10:00am-10:50am"), { startMin: 600, endMin: 650 });
    assert.deepEqual(parseTimeRange("1:00pm-2:59pm"), { startMin: 780, endMin: 899 });
    assert.deepEqual(parseTimeRange("12:00am-12:59pm"), { startMin: 0, endMin: 779 });
    assert.equal(parseClockToMin("3:59p"), 15 * 60 + 59);
    assert.equal(parseClockToMin("3:00am"), 180);
    assert.equal(parseClockToMin("3:60p"), null);
    assert.equal(parseClockToMin("13:00p"), null);
    assert.equal(parseClockToMin("0:30a"), null);
    assert.deepEqual(parseTimeRange("1:00p-13:00p"), null);
    assert.deepEqual(parseTimeRange("1:00p-1:60p"), null);
  });

  it("anchors time-range and clock regexes at both ends", () => {
    assert.equal(parseTimeRange("x3:30p-4:50p"), null);
    assert.equal(parseTimeRange("3:30p-4:50px"), null);
    assert.equal(parseTimeRange("3:30p-4:50p-5:00p"), null);
    assert.equal(parseClockToMin("x2:00p"), null);
    assert.equal(parseClockToMin("2:00px"), null);
    assert.equal(parseClockFlexible("x14:00"), null);
    assert.equal(parseClockFlexible("14:00x"), null);
    assert.equal(parseClockFlexible("114:00"), null);
  });

  it("handles internal whitespace directly in parseClockToMin and rejects garbage", () => {
    assert.equal(parseClockToMin("2:00 pm"), 840);
    assert.equal(parseClockToMin(" 2:00\tPM "), 840);
    assert.equal(parseClockToMin("garbage"), null);
    assert.equal(parseClockToMin(""), null);
  });

  it("parses 24h boundaries and rejects out-of-range 24h values", () => {
    assert.equal(parseClockFlexible("00:30"), 30);
    assert.equal(parseClockFlexible("0:00"), 0);
    assert.equal(parseClockFlexible("23:59"), 23 * 60 + 59);
    assert.equal(parseClockFlexible("23:60"), null);
    assert.equal(parseClockFlexible("24:00"), 1440);
  });

  it("parseTimeWindow rejects missing or unparseable endpoints without throwing", () => {
    assert.equal(parseTimeWindow(undefined, "10:00"), null);
    assert.equal(parseTimeWindow("10:00", undefined), null);
    assert.equal(parseTimeWindow("", "10:00"), null);
    assert.equal(parseTimeWindow("10:00", ""), null);
    assert.equal(parseTimeWindow("bogus", "10:00"), null);
    assert.equal(parseTimeWindow("10:00", "bogus"), null);
    assert.deepEqual(parseTimeWindow("00:00", "00:01"), { startMin: 0, endMin: 1 });
  });

  it("tokenizes Th/Sa at the start of the string and single-letter T/R/S", () => {
    assert.deepEqual(parseDaysColumn("ThF"), ["R", "F"]);
    assert.deepEqual(parseDaysColumn("SaM"), ["S", "M"]);
    assert.deepEqual(parseDaysColumn("TuThFrSaMo"), ["T", "R", "F", "S", "M"]);
    assert.deepEqual(parseDaysColumn("MTWRFS"), ["M", "T", "W", "R", "F", "S"]);
    assert.deepEqual(parseDaysColumn("T"), ["T"]);
    assert.deepEqual(parseDaysColumn("R"), ["R"]);
    assert.deepEqual(parseDaysColumn("S"), ["S"]);
    assert.deepEqual(parseDaysColumn("MoTuWeThFrSa"), ["M", "T", "W", "R", "F", "S"]);
    assert.deepEqual(parseDaysColumn("SuM"), []);
    assert.deepEqual(parseDaysColumn("MSun"), []);
  });

  it("maps every API day alias to its code, case-insensitively", () => {
    const expected: Record<string, string> = {
      mo: "M", mon: "M", monday: "M",
      tu: "T", tue: "T", tues: "T", tuesday: "T",
      we: "W", wed: "W", wednesday: "W",
      th: "R", thu: "R", thur: "R", thurs: "R", thursday: "R",
      fr: "F", fri: "F", friday: "F",
      sa: "S", sat: "S", saturday: "S",
      m: "M", t: "T", w: "W", r: "R", f: "F", s: "S",
    };
    for (const [alias, code] of Object.entries(expected)) {
      assert.equal(parseDayQuery(alias), code, alias);
      assert.equal(parseDayQuery(alias.toUpperCase()), code, alias.toUpperCase());
    }
    assert.equal(parseDayQuery(""), null);
    assert.equal(parseDayQuery("su"), null);
  });

  it("mergeIntervals handles empty input and ignores non-finite bounds", () => {
    assert.deepEqual(mergeIntervals([]), []);
    assert.deepEqual(mergeIntervals([{ startMin: -Infinity, endMin: 10 }]), []);
    assert.deepEqual(mergeIntervals([{ startMin: 5, endMin: Infinity }]), []);
    assert.deepEqual(mergeIntervals([{ startMin: Number.NaN, endMin: 10 }, { startMin: 1, endMin: 2 }]), [
      { startMin: 1, endMin: 2 },
    ]);
  });

  it("computeFreeIntervals merges unsorted busy input by default and rejects non-finite windows", () => {
    assert.deepEqual(
      computeFreeIntervals(
        [
          { startMin: 600, endMin: 700 },
          { startMin: 480, endMin: 540 },
          { startMin: 520, endMin: 620 },
        ],
        480,
        900
      ),
      [{ startMin: 700, endMin: 900 }]
    );
    assert.deepEqual(computeFreeIntervals([], 0, Infinity), []);
    assert.deepEqual(computeFreeIntervals([], -Infinity, 100), []);
    assert.deepEqual(computeFreeIntervals([], Number.NaN, 100), []);
    assert.deepEqual(computeFreeIntervals([], 0, Number.NaN), []);
    assert.deepEqual(computeFreeIntervals([], 100, 50), []);
    assert.deepEqual(computeFreeIntervals([], 100, 100), []);
  });

  it("computeFreeIntervals ignores blocks outside the window and keeps cursor monotonic", () => {
    // block entirely after the window must not extend free time past windowEnd
    assert.deepEqual(computeFreeIntervals([{ startMin: 700, endMin: 800 }], 480, 600, true), [
      { startMin: 480, endMin: 600 },
    ]);
    // block entirely before the window
    assert.deepEqual(computeFreeIntervals([{ startMin: 100, endMin: 200 }], 480, 600, true), [
      { startMin: 480, endMin: 600 },
    ]);
    // nested block in an input flagged alreadyMerged must not move the cursor backwards
    assert.deepEqual(
      computeFreeIntervals(
        [
          { startMin: 480, endMin: 580 },
          { startMin: 490, endMin: 500 },
        ],
        480,
        600,
        true
      ),
      [{ startMin: 580, endMin: 600 }]
    );
  });

  it("nowPacific maps every weekday label to its code", () => {
    // 2026-04-13 is a Monday; noon UTC = 05:00 PDT same day
    const cases: Array<[string, string | null, string]> = [
      ["2026-04-13T20:00:00Z", "M", "Mon"],
      ["2026-04-14T20:00:00Z", "T", "Tue"],
      ["2026-04-15T20:00:00Z", "W", "Wed"],
      ["2026-04-16T20:00:00Z", "R", "Thu"],
      ["2026-04-17T20:00:00Z", "F", "Fri"],
      ["2026-04-18T20:00:00Z", "S", "Sat"],
      ["2026-04-19T20:00:00Z", null, "Sun"],
    ];
    for (const [iso, day, label] of cases) {
      const got = nowPacific(new Date(iso));
      assert.equal(got.day, day, iso);
      assert.equal(got.weekdayLabel, label, iso);
      assert.equal(got.minutes, 13 * 60, iso);
    }
    // UTC date differs from Pacific date: Sat 00:30 UTC is still Fri 17:30 PDT
    assert.deepEqual(nowPacific(new Date("2026-04-18T00:30:00Z")), { day: "F", minutes: 17 * 60 + 30, weekdayLabel: "Fri" });
  });
});

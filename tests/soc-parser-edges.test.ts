import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseScheduleHtml, parseTermsHtml, parseTotalResultPages } from "../server/soc/parser";

const HEADER = (num: string, title: string) =>
  `<tr><td class="crsheader"></td><td class="crsheader">${num}</td><td class="crsheader"><a><span class="boldtxt">${title}</span></a></td></tr>`;

function cell(text: string, attrs = ""): string {
  return `<td class="brdr"${attrs}>${text}</td>`;
}

/** Build a sectxt row from raw cell texts (index 0..n). */
function sectionRow(cells: string[]): string {
  return `<tr class="sectxt">${cells.map((c) => cell(c)).join("")}</tr>`;
}

function table(...rows: string[]): string {
  return `<table class="tbrdr">${rows.join("")}</table>`;
}

// cells: 0 blank, 1 course#, 2 sectionId, 3 type, 4 section, 5 days, 6 time, 7 building, 8 room, 9 instructor, 10 available, 11 limit
function fullRow(over: Partial<Record<number, string>> = {}, count = 12): string {
  const base = ["", "", "111", "LE", "A00", "TuTh", "1:00p-2:20p", "CENTR", "109", "Staff", "10", "100"];
  for (const [k, v] of Object.entries(over)) base[Number(k)] = v!;
  return sectionRow(base.slice(0, count));
}

describe("parseScheduleHtml edge behavior", () => {
  it("skips a section when exactly one of section/days/time/available says cancelled (both spellings)", () => {
    for (const [idx, word] of [
      [4, "Cancelled"],
      [5, "Canceled"],
      [6, "CANCELLED"],
      [10, "canceled"],
    ] as const) {
      const html = table(HEADER("100", "T"), fullRow({ [idx]: word }), fullRow({ 2: "222" }));
      const rows = parseScheduleHtml(html, "SP26", "CSE");
      assert.deepEqual(rows.map((r) => r.sectionId), ["222"], `cell ${idx} (${word}) must drop only that row`);
    }
    // word-boundary: a longer word containing the text is not a cancellation
    const kept = parseScheduleHtml(table(HEADER("100", "T"), fullRow({ 4: "Cancelledish" })), "SP26", "CSE");
    assert.equal(kept.length, 1);
  });

  it("applies the cancelled check to the collapsed colspan TBA row too", () => {
    const html = table(
      HEADER("199", "Indep"),
      `<tr class="sectxt">${cell("")}${cell("")}${cell("333")}${cell("IN")}${cell("001")}${cell("TBA", ' colspan="4"')}${cell("Staff")}${cell("Cancelled")}${cell("")}${cell("")}</tr>`
    );
    assert.equal(parseScheduleHtml(html, "SP26", "CSE").length, 0);
  });

  it("maps available/limit by cell count in the normal layout and leaves them empty when absent", () => {
    const twelve = parseScheduleHtml(table(HEADER("100", "T"), fullRow({}, 12)), "SP26", "CSE")[0]!;
    assert.equal(twelve.available, "10");
    assert.equal(twelve.limit, "100");
    assert.equal(twelve.instructor, "Staff");

    const eleven = parseScheduleHtml(table(HEADER("100", "T"), fullRow({}, 11)), "SP26", "CSE")[0]!;
    assert.equal(eleven.available, "10");
    assert.equal(eleven.limit, "");

    const ten = parseScheduleHtml(table(HEADER("100", "T"), fullRow({}, 10)), "SP26", "CSE")[0]!;
    assert.equal(ten.instructor, "Staff");
    assert.equal(ten.available, "");
    assert.equal(ten.limit, "");
  });

  it("reads limit from the colspan TBA layout", () => {
    const html = table(
      HEADER("199", "Indep"),
      `<tr class="sectxt">${cell("")}${cell("")}${cell("333")}${cell("IN")}${cell("001")}${cell("TBA", ' colspan="4"')}${cell("Staff")}${cell("5")}${cell("42")}${cell("")}</tr>`
    );
    const row = parseScheduleHtml(html, "SP26", "CSE")[0]!;
    assert.equal(row.available, "5");
    assert.equal(row.limit, "42");
  });

  it("collapses internal whitespace and trims subject code", () => {
    const html = table(HEADER("  100 ", "Adv   Data\n  Structures"), fullRow({ 9: "Smith,   John\n  Q" }));
    const row = parseScheduleHtml(html, "SP26", "  CSE ")[0]!;
    assert.equal(row.subject, "CSE");
    assert.equal(row.courseTitle, "Adv Data Structures");
    assert.equal(row.instructor, "Smith, John Q");
    assert.equal(row.courseNumber, "100");
  });

  it("starts with empty course number/title when no header precedes a section", () => {
    const row = parseScheduleHtml(table(fullRow()), "SP26", "CSE")[0]!;
    assert.equal(row.courseNumber, "");
    assert.equal(row.courseTitle, "");
    assert.equal(row.subjectName, undefined);
  });

  it("header rows: title-only header updates title but keeps number; empty header changes nothing", () => {
    const html = table(
      HEADER("100", "First"),
      fullRow({ 2: "1" }),
      HEADER("", "Renamed"),
      fullRow({ 2: "2" }),
      HEADER("", ""),
      fullRow({ 2: "3" }),
      HEADER("200", ""),
      fullRow({ 2: "4" })
    );
    const rows = parseScheduleHtml(html, "SP26", "CSE");
    assert.deepEqual(
      rows.map((r) => [r.sectionId, r.courseNumber, r.courseTitle]),
      [
        ["1", "100", "First"],
        ["2", "100", "Renamed"],
        ["3", "100", "Renamed"],
        ["4", "200", ""],
      ]
    );
  });

  it("extracts subjectName from the h2 heading and prefers a row's own course number", () => {
    const html = `<h2><span class="centeralign">Computer Science (CSE)</span></h2>` +
      table(HEADER("100", "T"), fullRow({ 1: "100L" }));
    const row = parseScheduleHtml(html, "SP26", "CSE")[0]!;
    assert.equal(row.subjectName, "CSE");
    assert.equal(row.courseNumber, "100L");
    assert.equal(parseScheduleHtml(`<h2><span class="centeralign">No parens</span></h2>`, "SP26", "CSE").length, 0);
  });

  it("ignores rows without sectxt class and rows with fewer than 10 cells", () => {
    const nonSec = `<tr class="nonenrtxt">${["", "", "9", "FI", "A00", "Tu", "8:00a-9:00a", "B", "1", "S", "1", "1"].map((c) => cell(c)).join("")}</tr>`;
    const html = table(HEADER("100", "T"), nonSec, fullRow({}, 9), fullRow({}, 10));
    assert.equal(parseScheduleHtml(html, "SP26", "CSE").length, 1);
  });
});

describe("parseTotalResultPages edge behavior", () => {
  it("handles multi-digit page counts, extra whitespace, entity spacing, and case", () => {
    assert.equal(parseTotalResultPages("Page (1 of 6)"), 6);
    assert.equal(parseTotalResultPages("Page (10 of 12)"), 12);
    assert.equal(parseTotalResultPages("Page ( 3   of   25 )"), 25);
    assert.equal(parseTotalResultPages("Page(2 of 7)"), 7);
    assert.equal(parseTotalResultPages("Page (1&nbsp;&nbsp;of&nbsp;&nbsp;9)"), 9);
    assert.equal(parseTotalResultPages("Page (1&#160;&#160;of&#160;&#160;8)"), 8);
    assert.equal(parseTotalResultPages("Page (1 &nbsp;of&#160; 11)"), 11);
    assert.equal(parseTotalResultPages("PAGE (1 OF 5)"), 5);
    assert.equal(parseTotalResultPages("Page (1of6)"), 1);
    assert.equal(parseTotalResultPages("Page (1 of 6"), 1);
  });
});

describe("parseTermsHtml edge behavior", () => {
  it("skips options with a blank label", () => {
    const html = `<select id="selectedTerm"><option value="SP26">   </option><option value="FA26">Fall</option></select>`;
    assert.deepEqual(parseTermsHtml(html), [{ code: "FA26", label: "Fall" }]);
  });
});

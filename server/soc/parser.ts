import { load } from "cheerio";
import type { SectionRow, TermMeta } from "../types/schedule";

const CANCELLED_RE = /\bcancell?ed\b/i;
const PAGINATION_RE = /Page\s*\(\s*\d+(?:\s|&nbsp;|&#160;)+of(?:\s|&nbsp;|&#160;)+(\d+)\s*\)/i;
const IGNORED_TERM_CODES = new Set(["default_collection", "faculty-staff"]);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Parse one UCSD Schedule of Classes HTML page ("by subject" / tabs-sub view).
 * Processes recurring section rows (`tr.sectxt`) and intentionally skips
 * single-date final/midterm rows (`tr.nonenrtxt`) and cancelled sections.
 */
export function parseScheduleHtml(html: string, term: string, subjectCode: string): SectionRow[] {
  const $ = load(html);
  const rows: SectionRow[] = [];

  let courseNumber = "";
  let courseTitle = "";
  let subjectName: string | undefined;

  const heading = $("h2 span.centeralign").first().text();
  const subjectMatch = heading.match(/\(([^)]+)\)/);
  if (subjectMatch?.[1]) {
    subjectName = normalizeText(subjectMatch[1]);
  }

  $("table.tbrdr tr").each((_, tr) => {
    const el = $(tr);

    const headerCells = el.find("td.crsheader");
    if (headerCells.length) {
      const num = normalizeText($(headerCells.get(1)).text());
      const title = normalizeText(el.find("td.crsheader a span.boldtxt").first().text());
      if (num) {
        courseNumber = num;
        courseTitle = title;
      } else if (title) {
        courseTitle = title;
      }
      return;
    }

    if (!el.hasClass("sectxt")) return;

    const cells = el.find("td.brdr");
    if (cells.length < 10) return;

    const cellText = (index: number) => normalizeText($(cells.get(index)).text());

    const sectionId = cellText(2);
    const meetingType = cellText(3);
    const section = cellText(4);

    // UCSD collapses days/time/building/room into a single colspan="4" TBA cell on arranged sections.
    // Stryker disable next-line StringLiteral: parseInt("") is NaN and NaN >= 4 is false, exactly like parseInt("1") >= 4
    const daysColspan = Number.parseInt($(cells.get(5)).attr("colspan") ?? "1", 10);
    let days: string;
    let time: string;
    let building: string;
    let room: string;
    let instructor: string;
    let available: string;
    let limit: string;

    if (daysColspan >= 4) {
      days = cellText(5);
      time = "TBA";
      building = "TBA";
      room = "TBA";
      instructor = cellText(6);
      // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral: this branch is only reached with at least 10 cells (early return above), so the > 7 guard is always true
      available = cells.length > 7 ? cellText(7) : "";
      limit = cells.length > 8 ? cellText(8) : "";
    } else {
      days = cellText(5);
      time = cellText(6);
      building = cellText(7);
      room = cellText(8);
      instructor = cellText(9);
      available = cells.length > 10 ? cellText(10) : "";
      limit = cells.length > 11 ? cellText(11) : "";
    }

    if (
      CANCELLED_RE.test(section) ||
      CANCELLED_RE.test(days) ||
      CANCELLED_RE.test(time) ||
      CANCELLED_RE.test(available)
    ) {
      return;
    }

    const rowCourseNumber = cellText(1) || courseNumber;

    rows.push({
      term,
      subject: subjectCode.trim(),
      subjectName,
      courseNumber: rowCourseNumber,
      courseTitle,
      sectionId,
      meetingType,
      section,
      days,
      time,
      building,
      room,
      instructor,
      available,
      limit,
    });
  });

  return rows;
}

/** Extract total result pages from SOC pagination HTML (e.g. "Page (1&nbsp;of&nbsp;6)"). */
export function parseTotalResultPages(html: string): number {
  const match = html.match(PAGINATION_RE);
  if (!match?.[1]) return 1;
  const parsed = Number.parseInt(match[1], 10);
  // Stryker disable next-line EqualityOperator: parsed === 1 returns 1 via either branch
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Parse term options from the `#selectedTerm` dropdown on UCSD's SOC landing page. */
export function parseTermsHtml(html: string): TermMeta[] {
  const $ = load(html);
  const terms: TermMeta[] = [];
  const seen = new Set<string>();

  $("select#selectedTerm option").each((_, opt) => {
    // Stryker disable next-line StringLiteral: cheerio attr('value') on <option> falls back to the option text, so it is never undefined
    const code = normalizeText($(opt).attr("value") ?? "");
    const label = normalizeText($(opt).text());
    if (!code || !label || IGNORED_TERM_CODES.has(code) || seen.has(code)) return;
    seen.add(code);
    terms.push({ code, label });
  });

  return terms;
}

import { load } from "cheerio";
import type { SectionRow } from "./types";

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Parse one Schedule of Classes HTML response (subject / "tabs-sub" search). */
export function parseScheduleHtml(html: string, term: string, subjectCode: string): SectionRow[] {
  const $ = load(html);
  const rows: SectionRow[] = [];

  let courseNumber = "";
  let courseTitle = "";
  let subjectName: string | undefined;

  const h2 = $("h2 span.centeralign").first().text();
  const m = h2.match(/\(([^)]+)\)/);
  if (m) subjectName = norm(m[1]);

  $("table.tbrdr tr").each((_, tr) => {
    const el = $(tr);

    if (el.find("td.crsheader").length) {
      const tds = el.find("td.crsheader");
      const num = norm($(tds.get(1)).text());
      const titleLink = el.find("td.crsheader a span.boldtxt").first();
      const title = norm(titleLink.text());
      if (num) courseNumber = num;
      if (title) courseTitle = title;
      return;
    }

    if (!el.hasClass("sectxt")) return;

    const cells = el.find("td.brdr");
    if (cells.length < 10) return;

    const c = (i: number) => norm($(cells.get(i)).text());

    const secId = c(2);
    const mt = c(3);
    const sec = c(4);
    const days = c(5);
    const time = c(6);
    const building = c(7);
    const room = c(8);
    const instructor = c(9);
    const avail = cells.length > 10 ? c(10) : "";
    const lim = cells.length > 11 ? c(11) : "";

    const cn = norm($(cells.get(1)).text()) || courseNumber;

    rows.push({
      term,
      subject: subjectCode.trim(),
      subjectName,
      courseNumber: cn,
      courseTitle,
      sectionId: secId,
      meetingType: mt,
      section: sec,
      days,
      time,
      building,
      room,
      instructor,
      available: avail,
      limit: lim,
    });
  });

  return rows;
}

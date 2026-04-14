#!/usr/bin/env node
/**
 * Downloads the public UCSD Schedule of Classes (by-subject / "tabs-sub" view)
 * for a term and writes a normalized JSON array for EmptyBoard to serve locally.
 *
 * Usage:
 *   bun run scripts/sync-schedule.ts --term=WI26
 *   bun run scripts/sync-schedule.ts --term=WI26 --subjects=CSE,MATH
 *   bun run scripts/sync-schedule.ts --list-terms
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTotalResultPages } from "../server/pagination";
import { parseScheduleHtml } from "../server/parse-soc";
import {
  fetchSubjectListJson,
  fetchSubjectPage,
  fetchSubjectPageN,
  fetchTermsFromStudentPage,
} from "../server/soc-fetch";
import type { SectionRow } from "../server/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p?.split("=", 2)[1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function fetchAllPagesForSubject(term: string, subjectCode: string): Promise<SectionRow[]> {
  const first = await fetchSubjectPage(term, subjectCode, null);
  const htmls: string[] = [first.html];
  const total = parseTotalResultPages(first.html);
  let cookie = first.cookie;

  for (let page = 2; page <= total; page++) {
    const html = await fetchSubjectPageN(term, page, cookie);
    htmls.push(html);
  }

  const merged: SectionRow[] = [];
  const seen = new Set<string>();
  for (const html of htmls) {
    for (const row of parseScheduleHtml(html, term, subjectCode)) {
      const k = `${row.sectionId}|${row.section}|${row.meetingType}|${row.days}|${row.time}|${row.instructor}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(row);
    }
  }
  return merged;
}

async function main() {
  if (hasFlag("list-terms")) {
    const terms = await fetchTermsFromStudentPage();
    for (const t of terms) console.log(`${t.code}\t${t.label}`);
    return;
  }

  const termArg = arg("term");
  if (!termArg) {
    console.error("Usage: --term=WI26 [--subjects=CSE,MATH]");
    throw new Error("missing --term");
  }
  const term = termArg;

  let subjects: string[];
  const subArg = arg("subjects");
  if (subArg) {
    subjects = subArg.split(",").map((s) => s.trim().toUpperCase());
  } else {
    const list = await fetchSubjectListJson(term);
    subjects = list.map((s) => s.code.trim().toUpperCase());
  }

  await mkdir(DATA_DIR, { recursive: true });

  const concurrency = Math.min(8, parseInt(arg("concurrency") ?? "6", 10));
  const chunks: SectionRow[][] = Array.from({ length: subjects.length }, () => []);
  let i = 0;

  async function worker() {
    while (i < subjects.length) {
      const idx = i++;
      const sub = subjects[idx];
      if (sub === undefined) continue;
      process.stderr.write(`\r[${idx + 1}/${subjects.length}] ${sub}   `);
      try {
        chunks[idx] = await fetchAllPagesForSubject(term, sub);
      } catch (e) {
        console.error(`\nfail ${sub}:`, e);
        chunks[idx] = [];
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const out = chunks.flat();
  console.error(`\ndone: ${out.length} section rows`);

  const path = join(DATA_DIR, `${term}.json`);
  await writeFile(path, JSON.stringify(out, null, 0), "utf-8");
  console.log(path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

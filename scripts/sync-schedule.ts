#!/usr/bin/env node
/**
 * Downloads the public UCSD Schedule of Classes (by-subject / "tabs-sub" view)
 * for a term and atomically writes a normalized JSON array for EmptyBoard.
 *
 * Usage:
 *   npm run sync -- --term=SP26
 *   npm run sync -- --term=SP26 --subjects=CSE,MATH
 *   npm run sync -- --list-terms
 */

import { loadConfig } from "../server/config";
import { ScheduleStore, normalizeTermCode } from "../server/services/schedule-store";
import { ScheduleSyncService, parseSubjectCodes } from "../server/services/schedule-sync";
import { createSocClient } from "../server/soc/client";

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const socClient = createSocClient({
    timeoutMs: config.socTimeoutMs,
    maxRetries: config.socMaxRetries,
  });
  const store = new ScheduleStore({
    dataDir: config.dataDir,
    dailyWindow: config.dailyWindow,
  });
  const syncService = new ScheduleSyncService({
    socClient,
    store,
    termsCacheTtlMs: config.termsCacheTtlMs,
    defaultConcurrency: config.syncConcurrency,
  });

  if (hasFlag("list-terms")) {
    const { terms, source } = await syncService.getTerms();
    console.error(`Loaded ${terms.length} terms (source: ${source})`);
    for (const term of terms) {
      console.log(`${term.code}\t${term.label}`);
    }
    return;
  }

  const rawTerm = getArg("term");
  if (!rawTerm) {
    console.error("Usage: npm run sync -- --term=SP26 [--subjects=CSE,MATH] [--concurrency=6]");
    throw new Error("missing --term");
  }

  const term = normalizeTermCode(rawTerm);
  if (!term) {
    throw new Error(`invalid --term "${rawTerm}" (expected 4 alphanumeric characters, e.g. SP26)`);
  }

  const subjectsArg = getArg("subjects");
  let subjects: string[] | undefined;
  if (subjectsArg !== undefined) {
    const parsed = parseSubjectCodes(subjectsArg);
    if (!parsed.ok) {
      throw new Error(`invalid --subjects: ${parsed.error}`);
    }
    subjects = parsed.subjects;
  }

  const concurrencyArg = getArg("concurrency");
  const parsedConcurrency = concurrencyArg ? Number.parseInt(concurrencyArg, 10) : undefined;
  const concurrency =
    parsedConcurrency !== undefined && Number.isFinite(parsedConcurrency)
      ? Math.min(8, Math.max(1, parsedConcurrency))
      : config.syncConcurrency;

  const summary = await syncService.syncTerm(term, {
    subjects,
    concurrency,
    onProgress: (completed, total, subject) => {
      process.stderr.write(`\r[${completed}/${total}] ${subject.padEnd(6)} `);
    },
  });

  console.error(
    `\ndone: ${summary.sectionCount} section rows across ${summary.subjectsSucceeded}/${summary.subjectsRequested} subjects in ${summary.durationMs}ms`
  );
  if (summary.failedSubjects.length > 0) {
    console.error(`failed subjects (${summary.failedSubjects.length}): ${summary.failedSubjects.join(", ")}`);
  }
  console.log(summary.sourcePath);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

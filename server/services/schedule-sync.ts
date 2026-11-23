import type { SocClient } from "../soc/client";
import { parseScheduleHtml, parseTermsHtml, parseTotalResultPages } from "../soc/parser";
import type { SectionRow, SyncSummary, TermMeta, TermsResult } from "../types/schedule";
import { normalizeTermCode, type ScheduleStore } from "./schedule-store";

const SUBJECT_CODE_RE = /^[A-Z]{2,6}$/;

export type SyncTermOptions = {
  subjects?: string[];
  concurrency?: number;
  onProgress?: (completed: number, total: number, subject: string) => void;
};

type CachedTerms = {
  terms: TermMeta[];
  fetchedAt: number;
};

type TermSyncLock = {
  scope: string;
  promise: Promise<SyncSummary>;
};

export function parseSubjectCodes(
  raw: string,
  maxSubjects?: number
): { ok: true; subjects: string[] } | { ok: false; error: string } {
  const subjects = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  if (subjects.length === 0) {
    return { ok: false, error: "subjects must contain at least one valid subject code" };
  }

  if (maxSubjects !== undefined && subjects.length > maxSubjects) {
    return { ok: false, error: `At most ${maxSubjects} subjects may be specified per sync` };
  }

  for (const subject of subjects) {
    if (!SUBJECT_CODE_RE.test(subject)) {
      return { ok: false, error: `Invalid subject code: ${subject}` };
    }
  }

  return { ok: true, subjects };
}

/** Build a stable deduplication key across paginated and merged SOC rows. */
export function sectionDedupKey(row: SectionRow): string {
  return [
    row.subject.trim().toUpperCase(),
    row.courseNumber,
    row.sectionId,
    row.section,
    row.meetingType,
    row.days,
    row.time,
    row.building,
    row.room,
    row.instructor,
  ].join("|");
}

function dedupeSections(rows: readonly SectionRow[]): SectionRow[] {
  const merged: SectionRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = sectionDedupKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

export class ScheduleSyncService {
  private readonly socClient: SocClient;
  private readonly store: ScheduleStore;
  private readonly termsCacheTtlMs: number;
  private readonly defaultConcurrency: number;
  private termsCache: CachedTerms | null = null;
  private inFlightTerms: Promise<TermsResult> | null = null;
  private readonly activeTermSyncs = new Map<string, TermSyncLock>();

  constructor(opts: {
    socClient: SocClient;
    store: ScheduleStore;
    termsCacheTtlMs?: number;
    defaultConcurrency?: number;
  }) {
    this.socClient = opts.socClient;
    this.store = opts.store;
    this.termsCacheTtlMs = opts.termsCacheTtlMs ?? 60 * 60 * 1000;
    this.defaultConcurrency = opts.defaultConcurrency ?? 6;
  }

  /**
   * Fetch term metadata with single-flight coalescing, TTL caching, stale-cache fallback
   * on upstream failure, and disk fallback listing locally synced terms on cold-start outage.
   */
  getTerms(): Promise<TermsResult> {
    if (this.termsCache && Date.now() - this.termsCache.fetchedAt < this.termsCacheTtlMs) {
      return Promise.resolve({
        terms: this.termsCache.terms,
        source: "cache",
        fetchedAt: this.termsCache.fetchedAt,
      });
    }

    if (this.inFlightTerms) {
      return this.inFlightTerms;
    }

    const run = this.fetchTermsLiveWithFallback().finally(() => {
      this.inFlightTerms = null;
    });
    this.inFlightTerms = run;
    return run;
  }

  private async fetchTermsLiveWithFallback(): Promise<TermsResult> {
    try {
      const html = await this.socClient.fetchTermsPage();
      const terms = parseTermsHtml(html);
      if (terms.length > 0) {
        const fetchedAt = Date.now();
        this.termsCache = { terms, fetchedAt };
        return { terms, source: "live", fetchedAt };
      }
      throw new Error("UCSD SOC returned zero term options");
    } catch (err) {
      if (this.termsCache && this.termsCache.terms.length > 0) {
        return {
          terms: this.termsCache.terms,
          source: "stale-cache",
          fetchedAt: this.termsCache.fetchedAt,
        };
      }

      const localTerms = await this.store.listAvailableTermsOnDisk();
      if (localTerms.length > 0) {
        return {
          terms: localTerms.map((code) => ({ code, label: `${code} (local cache)` })),
          source: "disk-fallback",
          fetchedAt: Date.now(),
        };
      }

      throw err;
    }
  }

  async fetchAllPagesForSubject(term: string, subjectCode: string): Promise<SectionRow[]> {
    const first = await this.socClient.fetchSubjectFirstPage(term, subjectCode, null);
    const htmlPages: string[] = [first.html];
    const totalPages = parseTotalResultPages(first.html);
    const cookie = first.cookie;

    for (let page = 2; page <= totalPages; page++) {
      const pageHtml = await this.socClient.fetchSubjectResultPage(page, cookie);
      htmlPages.push(pageHtml);
    }

    const parsedRows: SectionRow[] = [];
    for (const html of htmlPages) {
      parsedRows.push(...parseScheduleHtml(html, term, subjectCode));
    }
    return dedupeSections(parsedRows);
  }

  /**
   * Run a live UCSD SOC sync serialized per term (with single-flight coalescing
   * when an identical scope is already running). Partial syncs merge updated subjects
   * into existing term data; major outages preserve the prior cached dataset.
   */
  syncTerm(term: string, opts: SyncTermOptions = {}): Promise<SyncSummary> {
    const normalizedTerm = normalizeTermCode(term);
    if (!normalizedTerm) {
      return Promise.reject(new Error(`Invalid term code: ${term}`));
    }

    let normalizedSubjects: string[] | undefined;
    if (opts.subjects !== undefined) {
      const parsed = parseSubjectCodes(opts.subjects.join(","));
      if (!parsed.ok) {
        return Promise.reject(new Error(parsed.error));
      }
      normalizedSubjects = parsed.subjects.sort();
    }

    const scope = normalizedSubjects ? normalizedSubjects.join(",") : "*";
    const existingLock = this.activeTermSyncs.get(normalizedTerm);

    if (existingLock && existingLock.scope === scope) {
      return existingLock.promise;
    }

    const runSync = () =>
      this.executeSync(normalizedTerm, {
        ...opts,
        subjects: normalizedSubjects,
      });

    const chained = existingLock
      ? existingLock.promise.catch(() => undefined).then(runSync)
      : runSync();

    const lockEntry: TermSyncLock = { scope, promise: chained };
    const tracked = chained.finally(() => {
      if (this.activeTermSyncs.get(normalizedTerm) === lockEntry) {
        this.activeTermSyncs.delete(normalizedTerm);
      }
    });
    lockEntry.promise = tracked;

    this.activeTermSyncs.set(normalizedTerm, lockEntry);
    return tracked;
  }

  private async executeSync(term: string, opts: SyncTermOptions): Promise<SyncSummary> {
    const t0 = performance.now();
    const isPartialSync = opts.subjects !== undefined;

    let subjects: string[];
    if (opts.subjects) {
      subjects = opts.subjects;
    } else {
      const list = await this.socClient.fetchSubjectListJson(term);
      subjects = [...new Set(list.map((s) => s.code.trim().toUpperCase()).filter(Boolean))];
    }

    if (subjects.length === 0) {
      throw new Error(`No subjects found for term ${term}`);
    }

    const concurrency = Math.min(8, Math.max(1, opts.concurrency ?? this.defaultConcurrency));
    const chunks: SectionRow[][] = Array.from({ length: subjects.length }, () => []);
    const succeededSubjects = new Set<string>();
    const failedSubjects: string[] = [];
    let nextIndex = 0;
    let completed = 0;

    const worker = async () => {
      while (nextIndex < subjects.length) {
        const idx = nextIndex++;
        const subject = subjects[idx];
        if (!subject) continue;

        try {
          chunks[idx] = await this.fetchAllPagesForSubject(term, subject);
          succeededSubjects.add(subject);
        } catch {
          failedSubjects.push(subject);
          chunks[idx] = [];
        } finally {
          completed += 1;
          opts.onProgress?.(completed, subjects.length, subject);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, subjects.length) }, () => worker()));
    failedSubjects.sort();

    const fetchedSections = chunks.flat();
    const existing = await this.store.loadTerm(term).catch(() => null);

    if (succeededSubjects.size === 0) {
      throw new Error(
        `Sync for ${term} failed for all ${subjects.length} subjects; existing cache preserved`
      );
    }

    if (
      !isPartialSync &&
      existing &&
      existing.sections.length > 0 &&
      failedSubjects.length > subjects.length / 2
    ) {
      throw new Error(
        `Sync for ${term} aborted (${failedSubjects.length}/${subjects.length} subjects failed); existing cache preserved`
      );
    }

    let finalSections: SectionRow[];
    if (isPartialSync && existing) {
      // Preserve unaffected departments and replace only the subjects that synced cleanly.
      const preserved = existing.sections.filter(
        (row) => !succeededSubjects.has(row.subject.trim().toUpperCase())
      );
      finalSections = dedupeSections([...preserved, ...fetchedSections]);
    } else if (!isPartialSync && existing && failedSubjects.length > 0) {
      // Retain prior rows for departments that failed transiently during a full sync.
      const failedSet = new Set(failedSubjects);
      const preserved = existing.sections.filter((row) =>
        failedSet.has(row.subject.trim().toUpperCase())
      );
      finalSections = dedupeSections([...preserved, ...fetchedSections]);
    } else {
      finalSections = dedupeSections(fetchedSections);
    }

    if (finalSections.length === 0) {
      throw new Error(
        `Sync for ${term} produced 0 sections (${failedSubjects.length}/${subjects.length} subjects failed); existing cache preserved`
      );
    }

    const saved = await this.store.saveTermAtomic(term, finalSections);

    return {
      term,
      subjectsRequested: subjects.length,
      subjectsSucceeded: succeededSubjects.size,
      failedSubjects,
      sectionCount: finalSections.length,
      durationMs: Math.round(performance.now() - t0),
      sourcePath: saved.sourcePath,
    };
  }
}

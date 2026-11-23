import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ScheduleStore, normalizeTermCode } from "../server/services/schedule-store";
import {
  ScheduleSyncError,
  ScheduleSyncService,
  parseSubjectCodes,
  sectionDedupKey,
} from "../server/services/schedule-sync";
import {
  UpstreamSocError,
  createSocClient,
  mergeCookies,
  subjectSearchBody,
  type SocClient,
} from "../server/soc/client";
import {
  parseScheduleHtml,
  parseTermsHtml,
  parseTotalResultPages,
} from "../server/soc/parser";
import type { SectionRow } from "../server/types/schedule";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures", "ucsd-soc-sample.html");

function makeRow(overrides: Partial<SectionRow> = {}): SectionRow {
  return {
    term: "SP26",
    subject: "CSE",
    courseNumber: "100",
    courseTitle: "ADS",
    sectionId: "",
    meetingType: "LE",
    section: "A00",
    days: "TuTh",
    time: "3:30p-4:50p",
    building: "CENTR",
    room: "109",
    instructor: "Staff",
    available: "10",
    limit: "100",
    ...overrides,
  };
}

function makeSubjectHtml(courseNumber: string, title: string, building: string, room: string, pages = 1): string {
  const pageBanner = pages > 1 ? `<div>Page  (1&nbsp;of&nbsp;${pages})</div>` : "";
  return `${pageBanner}<table class="tbrdr">
    <tr><td class="crsheader"></td><td class="crsheader">${courseNumber}</td><td class="crsheader"><a><span class="boldtxt">${title}</span></a></td></tr>
    <tr class="sectxt">
      <td class="brdr"></td><td class="brdr"></td><td class="brdr"></td>
      <td class="brdr">LE</td><td class="brdr">A00</td><td class="brdr">TuTh</td>
      <td class="brdr">1:00p-2:20p</td><td class="brdr">${building}</td><td class="brdr">${room}</td>
      <td class="brdr">Staff</td><td class="brdr">10</td><td class="brdr">100</td>
    </tr>
  </table>`;
}

describe("SOC HTML parser", () => {
  it("parses recurring sectxt rows, skips finals/cancelled/malformed rows, and resets courseTitle", async () => {
    const html = await readFile(FIXTURE_PATH, "utf-8");
    const rows = parseScheduleHtml(html, "SP26", "CSE");

    assert.equal(rows.length, 3);
    assert.equal(rows[0]!.subjectName, "CSE");
    assert.equal(rows[0]!.courseNumber, "100");
    assert.equal(rows[0]!.courseTitle, "Advanced Data Structures");
    assert.equal(rows[0]!.building, "CENTR");
    assert.equal(rows[0]!.room, "109");

    assert.equal(rows[1]!.courseNumber, "100");
    assert.equal(rows[1]!.sectionId, "410201");
    assert.equal(rows[1]!.meetingType, "DI");

    // Course 101 had a blank header title -> must NOT inherit "Advanced Data Structures"
    assert.equal(rows[2]!.courseNumber, "101");
    assert.equal(rows[2]!.courseTitle, "");
    assert.equal(rows[2]!.building, "PETER");
    assert.equal(rows[2]!.room, "108");

    // colspan="4" TBA rows map instructor/available cleanly instead of shifting into time/building
    const tbaRows = parseScheduleHtml(
      `<table class="tbrdr">
        <tr><td class="crsheader"></td><td class="crsheader">199</td><td class="crsheader"><a><span class="boldtxt">Independent Study</span></a></td></tr>
        <tr class="sectxt">
          <td class="brdr"></td><td class="brdr"></td><td class="brdr">276819</td>
          <td class="brdr">IN</td><td class="brdr">001</td>
          <td class="brdr" colspan="4">TBA</td>
          <td class="brdr">Sahoo, Debashis</td><td class="brdr">Unlim</td><td class="brdr"></td><td class="brdr"></td>
        </tr>
      </table>`,
      "SP26",
      "CSE"
    );
    assert.equal(tbaRows.length, 1);
    assert.equal(tbaRows[0]!.days, "TBA");
    assert.equal(tbaRows[0]!.time, "TBA");
    assert.equal(tbaRows[0]!.building, "TBA");
    assert.equal(tbaRows[0]!.room, "TBA");
    assert.equal(tbaRows[0]!.instructor, "Sahoo, Debashis");
    assert.equal(tbaRows[0]!.available, "Unlim");
  });

  it("anchors pagination extraction to Page (X of Y) and ignores course title prose", async () => {
    const html = await readFile(FIXTURE_PATH, "utf-8");
    assert.equal(parseTotalResultPages(html), 6);
    assert.equal(parseTotalResultPages("<td>History of 20th Century</td><td>proof 2</td>"), 1);
    assert.equal(parseTotalResultPages("Page (1&#160;of&#160;4)"), 4);
    assert.equal(parseTotalResultPages("Page (1 of 0)"), 1);
    assert.equal(parseTotalResultPages(""), 1);
  });

  it("parses #selectedTerm options, skips ignored values, and deduplicates codes", () => {
    const html = `
      <select id="selectedTerm">
        <option value="default_collection">All</option>
        <option value="faculty-staff">Faculty</option>
        <option value="SP26">Spring Quarter 2026</option>
        <option value="SP26">Spring Duplicate</option>
        <option value="S126">  Summer Sessions I 2026 </option>
        <option value="">Blank</option>
      </select>
    `;
    assert.deepEqual(parseTermsHtml(html), [
      { code: "SP26", label: "Spring Quarter 2026" },
      { code: "S126", label: "Summer Sessions I 2026" },
    ]);
  });
});

describe("resilient SOC HTTP client", () => {
  it("passes AbortSignal.timeout and retries TimeoutError, network errors, 429, and 503 with body cancel", async () => {
    let attempts = 0;
    let bodyCancelled = false;
    let sawAbortSignal = false;

    const client = createSocClient({
      maxRetries: 4,
      retryBaseDelayMs: 1,
      fetchImpl: (async (_url, init) => {
        attempts += 1;
        if (init?.signal instanceof AbortSignal) sawAbortSignal = true;
        if (attempts === 1) throw new DOMException("Timed out", "TimeoutError");
        if (attempts === 2) throw new TypeError("fetch failed: ECONNRESET");
        if (attempts === 3) return new Response("rate limited", { status: 429 });
        if (attempts === 4) {
          const stream = new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array([65]));
            },
            cancel() {
              bodyCancelled = true;
            },
          });
          return new Response(stream, { status: 503 });
        }
        return new Response("<html>ok</html>", { status: 200 });
      }) as typeof fetch,
    });

    const html = await client.fetchTermsPage();
    assert.equal(attempts, 5);
    assert.equal(sawAbortSignal, true);
    assert.equal(bodyCancelled, true);
    assert.equal(html, "<html>ok</html>");
  });

  it("does not retry non-retryable 404, non-array JSON, or malformed JSON, and honors maxRetries=0", async () => {
    let attempts404 = 0;
    const c404 = createSocClient({
      maxRetries: 2,
      retryBaseDelayMs: 1,
      fetchImpl: (async () => {
        attempts404 += 1;
        return new Response("not found", { status: 404 });
      }) as typeof fetch,
    });

    await assert.rejects(
      () => c404.fetchTermsPage(),
      (err: unknown) => err instanceof UpstreamSocError && err.status === 404 && !err.retryable
    );
    assert.equal(attempts404, 1);

    let attemptsBadJson = 0;
    const cBadJson = createSocClient({
      maxRetries: 2,
      retryBaseDelayMs: 1,
      fetchImpl: (async () => {
        attemptsBadJson += 1;
        return new Response("{not-json", { status: 200 });
      }) as typeof fetch,
    });
    await assert.rejects(
      () => cBadJson.fetchSubjectListJson("SP26"),
      (err: unknown) => err instanceof UpstreamSocError && !err.retryable
    );
    assert.equal(attemptsBadJson, 1);

    let attemptsNonArray = 0;
    const cNonArray = createSocClient({
      maxRetries: 2,
      retryBaseDelayMs: 1,
      fetchImpl: (async () => {
        attemptsNonArray += 1;
        return new Response('{"not":"array"}', { status: 200 });
      }) as typeof fetch,
    });
    await assert.rejects(
      () => cNonArray.fetchSubjectListJson("SP26"),
      (err: unknown) => err instanceof UpstreamSocError && !err.retryable
    );
    assert.equal(attemptsNonArray, 1);

    let attemptsZero = 0;
    const cZero = createSocClient({
      maxRetries: 0,
      retryBaseDelayMs: 1,
      fetchImpl: (async () => {
        attemptsZero += 1;
        throw new TypeError("network down");
      }) as typeof fetch,
    });
    await assert.rejects(() => cZero.fetchTermsPage(), UpstreamSocError);
    assert.equal(attemptsZero, 1);
  });

  it("includes all classroom course levels in subjectSearchBody and merges multi-Set-Cookie headers", () => {
    const body = new URLSearchParams(subjectSearchBody("SP26", " CSE "));
    assert.equal(body.get("selectedTerm"), "SP26");
    assert.equal(body.get("selectedSubjects"), "CSE ");
    for (const opt of [
      "schedOption1", "schedOption11", "schedOption12",
      "schedOption2", "schedOption4", "schedOption5",
      "schedOption3", "schedOption7", "schedOption8",
      "schedOption13", "schedOption10", "schedOption9",
    ]) {
      assert.equal(body.get(opt), "true", `Expected ${opt}=true`);
    }
    assert.deepEqual(body.getAll("schDay"), ["M", "T", "W", "R", "F", "S"]);

    const headers = new Headers();
    headers.append("set-cookie", "jlinksessionidx=abc123; Path=/; HttpOnly");
    headers.append("set-cookie", "TS01=xyz; Path=/");
    const res = new Response("", { headers });
    assert.equal(
      mergeCookies("prior=1; jlinksessionidx=old", res),
      "prior=1; jlinksessionidx=abc123; TS01=xyz"
    );
  });
});

describe("ScheduleSyncService and ScheduleStore", () => {
  it("deduplicates accurately without colliding blank-sectionId courses and paginates with cookies", async () => {
    const cse100 = makeRow({ courseNumber: "100", building: "CENTR", room: "109" });
    const cse101 = makeRow({ courseNumber: "101", building: "PETER", room: "108" });
    const math100 = makeRow({ subject: "MATH", courseNumber: "100", building: "CENTR", room: "109" });

    assert.notEqual(sectionDedupKey(cse100), sectionDedupKey(cse101));
    assert.notEqual(sectionDedupKey(cse100), sectionDedupKey(math100));
    assert.equal(sectionDedupKey(cse100), sectionDedupKey({ ...cse100 }));

    assert.deepEqual(parseSubjectCodes(" cse , MATH , cse "), { ok: true, subjects: ["CSE", "MATH"] });
    assert.equal(parseSubjectCodes(",,,").ok, false);
    assert.equal(parseSubjectCodes("CSE,123").ok, false);
    assert.equal(parseSubjectCodes("CSE,MATH,ECE", 2).ok, false);

    // Multi-page subject pagination forwards session cookie and deduplicates overlap across pages
    const seenCookies: string[] = [];
    const pagedSoc: SocClient = {
      async fetchTermsPage() { return ""; },
      async fetchSubjectListJson() { return []; },
      async fetchSubjectFirstPage() {
        return { cookie: "sid=page-cookie", html: makeSubjectHtml("100", "ADS", "CENTR", "109", 2) };
      },
      async fetchSubjectResultPage(page, cookie) {
        seenCookies.push(`${page}:${cookie}`);
        // Duplicate 100 plus new 101 on page 2
        return makeSubjectHtml("100", "ADS", "CENTR", "109") + makeSubjectHtml("101", "Algo", "PETER", "108");
      },
    };
    const tempDir = await mkdtemp(join(tmpdir(), "emptyboard-page-test-"));
    try {
      const store = new ScheduleStore({ dataDir: tempDir, dailyWindow: { dayStartMin: 480, dayEndMin: 1320 } });
      const svc = new ScheduleSyncService({ socClient: pagedSoc, store });
      const rows = await svc.fetchAllPagesForSubject("SP26", "CSE");
      assert.deepEqual(seenCookies, ["2:sid=page-cookie"]);
      assert.deepEqual(rows.map((r) => r.courseNumber).sort(), ["100", "101"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("handles partial-sync merges/rollbacks and >50% vs <=50% full-sync failure branches", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "emptyboard-sync-branches-"));
    try {
      const store = new ScheduleStore({ dataDir: tempDir, dailyWindow: { dayStartMin: 480, dayEndMin: 1320 } });
      await store.saveTermAtomic("SP26", [
        makeRow({ subject: "CSE", courseNumber: "11", building: "CENTR", room: "101" }),
        makeRow({ subject: "MATH", courseNumber: "20C", building: "PETER", room: "108" }),
        makeRow({ subject: "ECE", courseNumber: "35", building: "WLH", room: "2001" }),
      ]);

      let failingSubjects = new Set<string>();
      const fakeSoc: SocClient = {
        async fetchTermsPage() { return ""; },
        async fetchSubjectListJson() {
          return [
            { code: "CSE ", value: "CSE" },
            { code: "MATH", value: "MATH" },
            { code: "ECE ", value: "ECE" },
          ];
        },
        async fetchSubjectFirstPage(_term, subject) {
          const code = subject.trim().toUpperCase();
          if (failingSubjects.has(code)) {
            throw new UpstreamSocError(`${code} failed`, { url: "https://act.ucsd.edu", status: 503 });
          }
          return { cookie: "sid=1", html: makeSubjectHtml("200", `Fresh ${code}`, code, "100") };
        },
        async fetchSubjectResultPage() { return ""; },
      };

      const syncService = new ScheduleSyncService({ socClient: fakeSoc, store });

      // 1. Partial sync where all requested subjects fail rolls back cleanly (existing cache preserved)
      failingSubjects = new Set(["ECE"]);
      await assert.rejects(() => syncService.syncTerm("SP26", { subjects: ["ECE"] }), ScheduleSyncError);
      assert.equal((await store.loadTerm("SP26"))?.sections.length, 3);

      // 2. Multi-subject partial sync where CSE succeeds and ECE fails updates CSE & preserves MATH + old ECE
      const mixedPartial = await syncService.syncTerm("SP26", { subjects: ["CSE", "ECE"] });
      assert.deepEqual(mixedPartial.failedSubjects, ["ECE"]);
      assert.equal(mixedPartial.subjectsSucceeded, 1);
      assert.deepEqual(
        (await store.loadTerm("SP26"))?.sections.map((s) => `${s.subject} ${s.courseNumber}`).sort(),
        ["CSE 200", "ECE 35", "MATH 20C"]
      );

      // 3. Full sync with >50% failed (2/3 failed, 1/3 succeeded) aborts and preserves existing cache
      failingSubjects = new Set(["MATH", "ECE"]);
      await assert.rejects(() => syncService.syncTerm("SP26"), ScheduleSyncError);
      assert.deepEqual(
        (await store.loadTerm("SP26"))?.sections.map((s) => `${s.subject} ${s.courseNumber}`).sort(),
        ["CSE 200", "ECE 35", "MATH 20C"]
      );

      // 4. Full sync with <=50% failed (1/3 failed: ECE) refreshes CSE+MATH and carries forward prior ECE
      failingSubjects = new Set(["ECE"]);
      const minorityFail = await syncService.syncTerm("SP26");
      assert.deepEqual(minorityFail.failedSubjects, ["ECE"]);
      assert.equal(minorityFail.subjectsSucceeded, 2);
      assert.deepEqual(
        (await store.loadTerm("SP26"))?.sections.map((s) => `${s.subject} ${s.courseNumber}`).sort(),
        ["CSE 200", "ECE 35", "MATH 200"]
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("coalesces identical concurrent syncs, serializes different scopes, and cleans up locks after failure", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "emptyboard-sync-lock-"));
    try {
      const store = new ScheduleStore({ dataDir: tempDir, dailyWindow: { dayStartMin: 480, dayEndMin: 1320 } });
      let fetchCalls = 0;
      let activeCount = 0;
      let maxConcurrentDifferentScopes = 0;
      let shouldFail = false;

      const fakeSoc: SocClient = {
        async fetchTermsPage() { return ""; },
        async fetchSubjectListJson() { return []; },
        async fetchSubjectFirstPage(_term, subject) {
          fetchCalls += 1;
          activeCount += 1;
          maxConcurrentDifferentScopes = Math.max(maxConcurrentDifferentScopes, activeCount);
          await new Promise((r) => setTimeout(r, 15));
          activeCount -= 1;
          if (shouldFail) throw new UpstreamSocError("fail", { url: "https://act.ucsd.edu", status: 503 });
          const code = subject.trim().toUpperCase();
          return { cookie: "sid=1", html: makeSubjectHtml("100", code, code, "101") };
        },
        async fetchSubjectResultPage() { return ""; },
      };

      const syncService = new ScheduleSyncService({ socClient: fakeSoc, store });

      // Identical scope coalesces into one upstream fetch
      const [a, b] = await Promise.all([
        syncService.syncTerm("SP26", { subjects: ["CSE"] }),
        syncService.syncTerm("SP26", { subjects: ["CSE"] }),
      ]);
      assert.equal(fetchCalls, 1);
      assert.equal(a.sectionCount, 1);
      assert.equal(b.sectionCount, 1);

      // Different scopes on same term serialize so both CSE and MATH end up merged in SP26.json
      activeCount = 0;
      maxConcurrentDifferentScopes = 0;
      await Promise.all([
        syncService.syncTerm("SP26", { subjects: ["CSE"] }),
        syncService.syncTerm("SP26", { subjects: ["MATH"] }),
      ]);
      assert.equal(maxConcurrentDifferentScopes, 1, "Different scopes for same term must execute sequentially");
      assert.deepEqual(
        (await store.loadTerm("SP26"))?.sections.map((s) => s.subject).sort(),
        ["CSE", "MATH"]
      );

      // Lock cleans up cleanly after failure so subsequent sync succeeds
      shouldFail = true;
      await assert.rejects(() => syncService.syncTerm("SP26", { subjects: ["ECE"] }), ScheduleSyncError);
      shouldFail = false;
      const recovered = await syncService.syncTerm("SP26", { subjects: ["ECE"] });
      assert.equal(recovered.sectionCount, 3);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("handles getTerms caching/fallbacks and ScheduleStore cache hit/miss, validation, and corrupt JSON", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "emptyboard-store-test-"));
    try {
      const store = new ScheduleStore({
        dataDir: tempDir,
        dailyWindow: { dayStartMin: 480, dayEndMin: 1320 },
        statCheckIntervalMs: 60_000,
      });

      assert.equal(normalizeTermCode("../package"), null);
      assert.equal(await store.loadTerm("../package"), null);
      assert.throws(() => store.getTermFilePath("../package"));

      await store.saveTermAtomic("SP26", [makeRow()]);

      let failTerms = false;
      let termCalls = 0;
      const fakeSoc: SocClient = {
        async fetchTermsPage() {
          termCalls += 1;
          if (failTerms) throw new UpstreamSocError("down", { url: "https://act.ucsd.edu", status: 503 });
          return '<select id="selectedTerm"><option value="SP26">Spring Quarter 2026</option></select>';
        },
        async fetchSubjectListJson() { return []; },
        async fetchSubjectFirstPage() { return { cookie: "", html: "" }; },
        async fetchSubjectResultPage() { return ""; },
      };

      // Wide 60s TTL -> deterministic live coalescing + cache hit without timing races
      const cachedSvc = new ScheduleSyncService({ socClient: fakeSoc, store, termsCacheTtlMs: 60_000 });
      const [t1, t2] = await Promise.all([cachedSvc.getTerms(), cachedSvc.getTerms()]);
      assert.equal(termCalls, 1);
      assert.equal(t1.source, "live");
      assert.equal(t2.source, "live");
      assert.equal((await cachedSvc.getTerms()).source, "cache");

      // Short 1ms TTL + 20ms sleep -> deterministic expiry + stale-cache fallback
      const expiringSvc = new ScheduleSyncService({ socClient: fakeSoc, store, termsCacheTtlMs: 1 });
      await expiringSvc.getTerms();
      await new Promise((r) => setTimeout(r, 20));
      failTerms = true;
      const stale = await expiringSvc.getTerms();
      assert.equal(stale.source, "stale-cache");
      assert.equal(stale.terms[0]?.code, "SP26");

      // Cold-start service with failing SOC falls back to local disk terms
      const coldSvc = new ScheduleSyncService({ socClient: fakeSoc, store });
      const diskFallback = await coldSvc.getTerms();
      assert.equal(diskFallback.source, "disk-fallback");
      assert.deepEqual(diskFallback.terms, [{ code: "SP26", label: "SP26 (local cache)" }]);

      // Fast-hit store (60s interval) vs always-revalidate store (0ms interval) -> zero timing flakiness
      const fastStore = new ScheduleStore({
        dataDir: tempDir,
        dailyWindow: { dayStartMin: 480, dayEndMin: 1320 },
        statCheckIntervalMs: 60_000,
      });
      await fastStore.loadTerm("SP26"); // cold miss -> 1 miss
      await fastStore.loadTerm("SP26"); // fast cache hit -> 1 hit
      assert.deepEqual(
        { hits: fastStore.getStats().termCacheHits, misses: fastStore.getStats().termCacheMisses },
        { hits: 1, misses: 1 }
      );

      const revalidateStore = new ScheduleStore({
        dataDir: tempDir,
        dailyWindow: { dayStartMin: 480, dayEndMin: 1320 },
        statCheckIntervalMs: 0,
      });
      await revalidateStore.loadTerm("SP26"); // cold miss -> 1 miss
      await revalidateStore.loadTerm("SP26"); // mtime revalidation hit -> 1 hit
      await revalidateStore.loadTerm("WI26"); // ENOENT -> 2 misses
      await writeFile(join(tempDir, "SP26.json"), JSON.stringify([makeRow(), makeRow({ room: "110" })]), "utf-8");
      await revalidateStore.loadTerm("SP26"); // modified file -> 3 misses
      assert.deepEqual(
        { hits: revalidateStore.getStats().termCacheHits, misses: revalidateStore.getStats().termCacheMisses },
        { hits: 1, misses: 3 }
      );

      // Corrupt non-array JSON file throws clearly
      await writeFile(join(tempDir, "FA26.json"), '{"not":"array"}', "utf-8");
      await assert.rejects(() => revalidateStore.loadTerm("FA26"), /must contain a JSON array/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

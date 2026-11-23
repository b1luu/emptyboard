import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import type { ActiveLogLevel, LogEntry } from "../server/middleware/logger";
import { ScheduleStore } from "../server/services/schedule-store";
import { ScheduleSyncError, ScheduleSyncService } from "../server/services/schedule-sync";
import { UpstreamSocError, type SocClient } from "../server/soc/client";
import { roomIdFromParts, type SectionRow } from "../server/types/schedule";

function sampleSections(): SectionRow[] {
  return [
    {
      term: "SP26",
      subject: "CSE",
      courseNumber: "100",
      courseTitle: "Advanced Data Structures",
      sectionId: "100001",
      meetingType: "LE",
      section: "A00",
      days: "TuTh",
      time: "9:00a-10:20a",
      building: "CSE",
      room: "120",
      instructor: "Staff",
      available: "10",
      limit: "100",
    },
    {
      term: "SP26",
      subject: "MATH",
      courseNumber: "20C",
      courseTitle: "Vector Calculus",
      sectionId: "200001",
      meetingType: "LE",
      section: "A00",
      days: "TuTh",
      time: "9:00a-10:20a",
      building: "CENTR",
      room: "102",
      instructor: "Staff",
      available: "5",
      limit: "200",
    },
  ];
}

describe("HTTP API integration", () => {
  let tempRoot = "";
  let dataDir = "";
  let distDir = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "emptyboard-api-test-"));
    dataDir = join(tempRoot, "data");
    distDir = join(tempRoot, "dist");
    await mkdir(dataDir, { recursive: true });
    await mkdir(join(distDir, "assets"), { recursive: true });
    await writeFile(join(distDir, "index.html"), "<!doctype html><html><body>SPA</body></html>", "utf-8");
    await writeFile(join(distDir, "assets", "app.js"), "console.log('ok');", "utf-8");
    await writeFile(join(dataDir, "SP26.json"), JSON.stringify(sampleSections()), "utf-8");
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = "";
    }
  });

  function buildTestServer(opts: {
    logLevel?: "info" | "warn" | "error" | "silent";
    logSink?: (entry: LogEntry, level: ActiveLogLevel) => void;
    socClient?: SocClient;
    statCheckIntervalMs?: number;
  } = {}) {
    const logs: Array<{ entry: LogEntry; level: ActiveLogLevel }> = [];
    const sink =
      opts.logSink ??
      ((entry: LogEntry, level: ActiveLogLevel) => {
        logs.push({ entry, level });
      });

    const config = loadConfig({
      EMPTYBOARD_DATA_DIR: dataDir,
      EMPTYBOARD_CLIENT_DIST_DIR: distDir,
      EMPTYBOARD_LOG_LEVEL: opts.logLevel ?? "info",
    });

    const store = new ScheduleStore({
      dataDir,
      dailyWindow: config.dailyWindow,
      statCheckIntervalMs: opts.statCheckIntervalMs ?? 60_000,
    });

    const socClient: SocClient = opts.socClient ?? {
      async fetchTermsPage() {
        return '<select id="selectedTerm"><option value="SP26">Spring Quarter 2026</option></select>';
      },
      async fetchSubjectListJson() {
        return [{ code: "CSE ", value: "CSE" }];
      },
      async fetchSubjectFirstPage() {
        return {
          cookie: "sid=1",
          html: `<table class="tbrdr">
            <tr><td class="crsheader"></td><td class="crsheader">105</td><td class="crsheader"><a><span class="boldtxt">Theory</span></a></td></tr>
            <tr class="sectxt">
              <td class="brdr"></td><td class="brdr"></td><td class="brdr"></td>
              <td class="brdr">LE</td><td class="brdr">A00</td><td class="brdr">MWF</td>
              <td class="brdr">11:00a-11:50a</td><td class="brdr">CSE</td><td class="brdr">2154</td>
              <td class="brdr">Staff</td><td class="brdr">10</td><td class="brdr">100</td>
            </tr>
          </table>`,
        };
      },
      async fetchSubjectResultPage() {
        return "";
      },
    };

    const syncService = new ScheduleSyncService({ socClient, store });
    const instance = createApp({ config, socClient, store, syncService, logSink: sink });
    return { ...instance, logs };
  }

  it("serves /health and /api/health with live index and cache hit/miss metrics", async () => {
    // statCheckIntervalMs: 0 guarantees deterministic mtime revalidation without timing sleeps
    const { app, logs } = buildTestServer({ statCheckIntervalMs: 0 });

    assert.equal((await app.request("/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00")).status, 200); // miss=1
    assert.equal((await app.request("/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00")).status, 200); // mtime hit=1
    assert.equal((await app.request("/api/rooms/search?term=WI26&day=Tu&start=14:00&end=15:00")).status, 404); // miss=2

    for (const path of ["/health", "/api/health"]) {
      logs.length = 0;
      const res = await app.request(path);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("x-request-id"));
      assert.ok(res.headers.get("x-response-time")?.endsWith("ms"));

      const body = (await res.json()) as {
        ok: boolean;
        status: string;
        service: string;
        mode: string;
        dailyWindow: { startMin: number; endMin: number };
        index: {
          loadedTerms: string[];
          availableTermsOnDisk: string[];
          totalSections: number;
          totalRooms: number;
          termCacheHits: number;
          termCacheMisses: number;
        };
      };

      assert.equal(body.ok, true);
      assert.equal(body.status, "ok");
      assert.equal(body.service, "emptyboard");
      assert.equal(body.mode, "room-availability");
      assert.deepEqual(body.dailyWindow, { startMin: 480, endMin: 1320 });
      assert.deepEqual(body.index, {
        loadedTerms: ["SP26"],
        availableTermsOnDisk: ["SP26"],
        totalSections: 2,
        totalRooms: 2,
        termCacheHits: 1,
        termCacheMisses: 2,
      });
      assert.equal(JSON.stringify(body).includes(dataDir), false);
      assert.equal(logs.length, 1);
      assert.equal(logs[0]!.entry.route, path);
    }
  });

  it("serves valid room search, free-now, room availability, schedule, terms, and partial sync responses", async () => {
    const { app } = buildTestServer();

    // GET /api/terms live then cache
    const t1 = await app.request("/api/terms");
    assert.equal(t1.status, 200);
    const tb1 = (await t1.json()) as { source: string; terms: Array<{ code: string }> };
    assert.equal(tb1.source, "live");
    assert.equal(tb1.terms[0]?.code, "SP26");
    const t2 = await app.request("/api/terms");
    assert.equal(((await t2.json()) as { source: string }).source, "cache");

    const searchQueries = [
      "/api/rooms/search?term=sp26&day=Tu&start=14:00&end=15:00",
      "/api/rooms/search?term=SP26&day=Tu&start=2:00p&end=3:00p",
      "/api/rooms/search?term=SP26&day=Tu&start=2:00%20pm&end=3:00%20pm",
      "/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00&minFreeMin=30&building=CSE&whiteboard=1",
    ];

    let discoveredRoomId = "";
    for (const q of searchQueries) {
      const res = await app.request(q);
      assert.equal(res.status, 200, `Expected 200 for ${q}`);
      const body = (await res.json()) as { term: string; rooms: Array<{ roomId: string }> };
      assert.equal(body.term, "SP26");
      assert.ok(body.rooms.length > 0);
      if (!discoveredRoomId) discoveredRoomId = body.rooms[0]!.roomId;
    }

    const freeNowRes = await app.request("/api/rooms/free-now?term=SP26&minFreeMin=30&whiteboard=1");
    assert.equal(freeNowRes.status, 200);
    const freeNowBody = (await freeNowRes.json()) as { timezone: string; whiteboardPlaceholder: boolean };
    assert.equal(freeNowBody.timezone, "America/Los_Angeles");
    assert.equal(freeNowBody.whiteboardPlaceholder, true);

    const detailRes = await app.request(`/api/rooms/${discoveredRoomId}/availability?term=SP26`);
    assert.equal(detailRes.status, 200);
    const detailBody = (await detailRes.json()) as { building: string; room: string; schedule: Record<string, unknown> };
    assert.ok(detailBody.building && detailBody.room && detailBody.schedule.T);

    // Valid canonical roomId absent from index returns 404 NOT_FOUND
    const missingRoomRes = await app.request(`/api/rooms/${roomIdFromParts("UNKNOWN", "999")}/availability?term=SP26`);
    assert.equal(missingRoomRes.status, 404);
    assert.equal(((await missingRoomRes.json()) as { error: { code: string } }).error.code, "NOT_FOUND");

    const schedRes = await app.request("/api/schedule/SP26");
    assert.equal(schedRes.status, 200);
    const schedBody = (await schedRes.json()) as Record<string, unknown>;
    assert.equal("sourcePath" in schedBody, false);
    assert.equal(schedBody.count, 2);

    // Partial sync updates CSE while preserving MATH and never exposes sourcePath
    const syncRes = await app.request("/api/schedule/SP26/sync?subjects=CSE", { method: "POST" });
    assert.equal(syncRes.status, 200);
    const syncBody = (await syncRes.json()) as Record<string, unknown>;
    assert.equal("sourcePath" in syncBody, false);
    assert.equal(syncBody.synced, true);
    assert.equal(syncBody.sectionCount, 2);
  });

  it("rejects invalid query and path parameters with 400 standard error envelopes", async () => {
    const { app } = buildTestServer();

    const canonicalId = roomIdFromParts("CSE", "120");
    const nonCanonicalAlias = `${canonicalId.slice(0, -1)}B`;
    const tooManySubjects = Array.from({ length: 26 }, (_, i) => `S${String.fromCharCode(65 + i)}`).join(",");

    const badCases: Array<{ path: string; code: string; method?: string }> = [
      { path: "/api/rooms/free-now", code: "INVALID_QUERY" },
      { path: "/api/rooms/free-now?term=1234", code: "INVALID_QUERY" },
      { path: "/api/rooms/free-now?term=../package", code: "INVALID_QUERY" },
      { path: "/api/schedule/INVALID", code: "BAD_REQUEST" },
      { path: "/api/rooms/search?term=SP26&day=Sun&start=14:00&end=15:00", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=constructor&start=14:00&end=15:00", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=__proto__&start=14:00&end=15:00", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=1%204:00&end=15:00", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=15:00&end=14:00", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=14:00&end=14:00", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00&minFreeMin=%2B12", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00&minFreeMin=%2012", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00&minFreeMin=12garbage", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00&minFreeMin=-5", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00&minFreeMin=1441", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00&building=", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00&building=%20%20", code: "INVALID_QUERY" },
      { path: "/api/rooms/search?term=SP26&day=Tu&start=14:00&end=15:00&whiteboard=maybe", code: "INVALID_QUERY" },
      { path: "/api/rooms/_x7_/availability?term=SP26", code: "BAD_REQUEST" },
      { path: `/api/rooms/${nonCanonicalAlias}/availability?term=SP26`, code: "BAD_REQUEST" },
      { path: "/api/schedule/SP26/sync?subjects=,,,", code: "INVALID_QUERY", method: "POST" },
      { path: `/api/schedule/SP26/sync?subjects=${tooManySubjects}`, code: "INVALID_QUERY", method: "POST" },
    ];

    for (const tc of badCases) {
      const res = await app.request(tc.path, { method: tc.method ?? "GET" });
      assert.equal(res.status, 400, `Expected 400 for ${tc.path}, got ${res.status}`);
      const body = (await res.json()) as {
        error: { code: string; message: string; details?: Record<string, unknown> };
        requestId: string;
      };
      assert.equal(body.error.code, tc.code, `Expected ${tc.code} for ${tc.path}`);
      assert.equal(body.requestId, res.headers.get("x-request-id"));
    }

    // Valid summer term passes validation and yields 404 NOT_FOUND when unindexed
    const s126Res = await app.request("/api/rooms/free-now?term=S126");
    assert.equal(s126Res.status, 404);
    assert.equal(((await s126Res.json()) as { error: { code: string } }).error.code, "NOT_FOUND");
  });

  it("handles API 404s, 5xx error classification/redaction, /api/terms 502, logger isolation, and static traversal", async () => {
    const { app, syncService, logs } = buildTestServer();

    // 1. GET /api, GET /api/nope, POST /api/nope -> single log with actual pathname as route & matching requestId
    for (const req of [
      { path: "/api", method: "GET" },
      { path: "/api/nope", method: "GET" },
      { path: "/api/nope", method: "POST" },
    ]) {
      logs.length = 0;
      const res = await app.request(req.path, { method: req.method });
      assert.equal(res.status, 404);
      const body = (await res.json()) as { error: { code: string }; requestId: string };
      assert.equal(body.error.code, "NOT_FOUND");
      assert.equal(body.requestId, res.headers.get("x-request-id"));
      assert.equal(logs.length, 1);
      assert.equal(logs[0]!.entry.route, req.path);
    }

    // 2. GET /api/terms returns 502 UPSTREAM_ERROR when both SOC and disk fallback are unavailable
    await rm(join(dataDir, "SP26.json"), { force: true });
    const failingTermsServer = buildTestServer({
      socClient: {
        async fetchTermsPage() {
          throw new UpstreamSocError("SOC 503", { url: "https://act.ucsd.edu/secret", status: 503 });
        },
        async fetchSubjectListJson() { return []; },
        async fetchSubjectFirstPage() { return { cookie: "", html: "" }; },
        async fetchSubjectResultPage() { return ""; },
      },
    });
    const t502 = await failingTermsServer.app.request("/api/terms");
    assert.equal(t502.status, 502);
    const tb502 = (await t502.json()) as { error: { code: string; details?: { upstreamStatus?: number } } };
    assert.equal(tb502.error.code, "UPSTREAM_ERROR");
    assert.equal(tb502.error.details?.upstreamStatus, 503);
    assert.equal(JSON.stringify(tb502).includes("secret"), false);
    await writeFile(join(dataDir, "SP26.json"), JSON.stringify(sampleSections()), "utf-8");

    // 3. Sync failure classification: TypeError -> 500, EACCES fs -> 500 w/ fallback details, UpstreamSocError/ScheduleSyncError -> 502
    let failureMode: "typeerror" | "fs" | "sync" | "upstream" = "typeerror";
    syncService.syncTerm = async () => {
      if (failureMode === "typeerror") throw new TypeError("unexpected local null");
      if (failureMode === "fs") {
        throw Object.assign(new Error("EACCES C:\\secret\\SP26.json"), { code: "EACCES", syscall: "open" });
      }
      if (failureMode === "sync") throw new ScheduleSyncError("all subjects failed");
      throw new UpstreamSocError("SOC 503", { url: "https://act.ucsd.edu/internal", status: 503 });
    };

    logs.length = 0;
    failureMode = "typeerror";
    const teRes = await app.request("/api/schedule/SP26/sync", { method: "POST" });
    assert.equal(teRes.status, 500);
    assert.equal(JSON.stringify(await teRes.json()).includes("unexpected local null"), false);
    assert.equal(logs.find((l) => l.entry.event === "http_request")?.entry.route, "/api/schedule/:term/sync");

    logs.length = 0;
    failureMode = "fs";
    const fsRes = await app.request("/api/schedule/SP26/sync", { method: "POST" });
    assert.equal(fsRes.status, 500);
    const fsBody = (await fsRes.json()) as {
      error: { code: string; details?: { fallbackAvailable: boolean; cachedSectionCount: number } };
    };
    assert.equal(fsBody.error.code, "INTERNAL_ERROR");
    assert.equal(fsBody.error.details?.fallbackAvailable, true);
    assert.equal(fsBody.error.details?.cachedSectionCount, 2);
    assert.equal(JSON.stringify(fsBody).includes("EACCES"), false);
    const fsErrLog = logs.find((l) => l.entry.event === "http_error");
    assert.ok((fsErrLog?.entry.error as { cause?: { message: string } })?.cause?.message.includes("EACCES"));

    failureMode = "upstream";
    const upRes = await app.request("/api/schedule/SP26/sync", { method: "POST" });
    assert.equal(upRes.status, 502);
    const upBody = (await upRes.json()) as {
      error: { code: string; details?: { upstreamStatus?: number; fallbackAvailable: boolean; cachedSectionCount: number } };
    };
    assert.equal(upBody.error.code, "UPSTREAM_ERROR");
    assert.equal(upBody.error.details?.upstreamStatus, 503);
    assert.equal(upBody.error.details?.fallbackAvailable, true);
    assert.equal(upBody.error.details?.cachedSectionCount, 2);
    assert.equal(JSON.stringify(upBody).includes("act.ucsd.edu"), false);

    failureMode = "sync";
    const syncErrRes = await app.request("/api/schedule/SP26/sync", { method: "POST" });
    assert.equal(syncErrRes.status, 502);
    const syncErrBody = (await syncErrRes.json()) as {
      error: { code: string; details?: { fallbackAvailable: boolean; cachedSectionCount: number } };
    };
    assert.equal(syncErrBody.error.code, "UPSTREAM_ERROR");
    assert.equal(syncErrBody.error.details?.fallbackAvailable, true);
    assert.equal(syncErrBody.error.details?.cachedSectionCount, 2);

    // 4. Throwing logSink never disrupts HTTP 200 or 500 responses
    const { app: throwLogApp, syncService: throwSync } = buildTestServer({
      logSink: () => {
        throw new Error("stdout broken");
      },
    });
    throwSync.syncTerm = async () => {
      throw new TypeError("boom");
    };
    assert.equal((await throwLogApp.request("/api/health")).status, 200);
    assert.equal((await throwLogApp.request("/api/schedule/SP26/sync", { method: "POST" })).status, 500);

    // 5. Static assets, /assets/, traversal, malformed URI, /api-docs, CORS, and silent log level
    logs.length = 0;
    assert.equal((await app.request("/")).status, 200);
    assert.equal((await app.request("/assets/app.js")).status, 200);
    assert.equal((await app.request("/assets/")).status, 404);
    assert.equal((await app.request("/%00")).status, 400);
    assert.equal((await app.request("/%E0%A4%A")).status, 400);
    for (const traversalPath of ["/%2e%2e/data/SP26.json", "/assets/%2e%2e/%2e%2e/data/SP26.json"]) {
      const tRes = await app.request(traversalPath);
      const tText = await tRes.text();
      assert.equal(tText.includes("Advanced Data Structures"), false, `${traversalPath} must never leak data files`);
    }
    assert.equal((await app.request("/api-docs")).status, 200);
    assert.equal(logs.length, 0, "Static routes must never emit API logs");

    const preflight = await app.request("/api/rooms/search", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "GET" },
    });
    assert.ok(preflight.headers.get("access-control-allow-origin"));
    assert.ok(preflight.headers.get("x-request-id"));

    const silent = buildTestServer({ logLevel: "silent" });
    const silentRes = await silent.app.request("/api/health");
    assert.equal(silentRes.status, 200);
    assert.ok(silentRes.headers.get("x-request-id"));
    assert.equal(silent.logs.length, 0);
  });
});

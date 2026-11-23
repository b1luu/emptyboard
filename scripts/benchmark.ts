#!/usr/bin/env node
/**
 * Reproducible scale and concurrency latency benchmark for EmptyBoard.
 *
 * Usage:
 *   npm run bench -- --term=SP26
 *   npm run bench:synthetic
 *   npm run bench -- --term=SP26 --requests=600 --concurrency=1,10,25,50 --json
 */

import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import { ScheduleStore, normalizeTermCode } from "../server/services/schedule-store";
import type { SectionRow } from "../server/types/schedule";

type RoundMetrics = {
  concurrency: number;
  requests: number;
  errors: number;
  totalDurationMs: number;
  rps: number;
  minMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

type BenchmarkReport = {
  mode: "real" | "synthetic";
  term: string;
  nodeVersion: string;
  platform: string;
  dataset: {
    sections: number;
    meetings: number;
    uniqueRooms: number;
    uniqueBuildings: number;
    coldIndexBuildMs: number;
  };
  thresholdP99Ms: number;
  minSectionsRequired: number;
  rounds: RoundMetrics[];
  memoryMB: {
    rss: number;
    heapUsed: number;
  };
  passed: boolean;
};

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseIntArg(name: string, fallback: number, min = 1): number {
  const raw = getArg(name);
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= min ? parsed : fallback;
}

function parseConcurrencyList(raw: string | undefined): number[] {
  if (!raw) return [1, 10, 25, 50];
  const parsed = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isSafeInteger(n) && n >= 1 && n <= 200);
  return parsed.length > 0 ? parsed : [1, 10, 25, 50];
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/** Deterministic pseudo-random generator (LCG) for reproducible synthetic datasets. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function generateSyntheticSections(term: string, count: number): SectionRow[] {
  const rng = createRng(20260414);
  const subjects = [
    "CSE", "MATH", "ECE", "PHYS", "CHEM", "BILD", "ECON", "COGS", "DSC", "MAE",
    "POLI", "PSYC", "SOCI", "HIST", "LIGN", "MUS", "VIS", "BENG", "SIO", "CAT",
  ];
  const buildings = [
    "CENTR", "PETER", "WLH", "SOLIS", "LEDN", "YORK", "PCYNH", "CSE", "EBU3B", "APM",
    "GH", "HSS", "MCGIL", "MANDE", "PEPPER", "RWAC", "MOS", "RCLAS", "TBA", "GALB",
    "SEQUO", "CSB", "TATA", "WARRN", "PODEM",
  ];
  const dayPatterns = ["MWF", "TuTh", "M", "Tu", "W", "Th", "F", "MW", "Sa"];
  const timeSlots = [
    "8:00a-8:50a", "9:00a-9:50a", "9:30a-10:50a", "10:00a-10:50a", "11:00a-11:50a",
    "11:00a-12:20p", "12:00p-12:50p", "12:30p-1:50p", "1:00p-1:50p", "2:00p-2:50p",
    "2:00p-3:20p", "3:00p-3:50p", "3:30p-4:50p", "4:00p-4:50p", "5:00p-6:20p",
    "6:30p-7:50p", "8:00p-8:50p", "TBA",
  ];
  const roomsPerBuilding = 16;

  const rows: SectionRow[] = [];
  for (let i = 0; i < count; i++) {
    const subject = subjects[Math.floor(rng() * subjects.length)]!;
    const building = buildings[Math.floor(rng() * buildings.length)]!;
    const roomNum = 100 + Math.floor(rng() * roomsPerBuilding);
    const days = dayPatterns[Math.floor(rng() * dayPatterns.length)]!;
    const time = timeSlots[Math.floor(rng() * timeSlots.length)]!;

    rows.push({
      term,
      subject,
      courseNumber: String(1 + Math.floor(rng() * 199)),
      courseTitle: `${subject} Synthetic Course`,
      sectionId: String(400000 + i),
      meetingType: i % 3 === 0 ? "LE" : "DI",
      section: `A${String(i % 20).padStart(2, "0")}`,
      days,
      time,
      building,
      room: building === "TBA" ? "TBA" : String(roomNum),
      instructor: "Staff",
      available: String(Math.floor(rng() * 40)),
      limit: "120",
    });
  }
  return rows;
}

function buildWorkloadPaths(term: string, roomIds: readonly string[], buildings: readonly string[]): string[] {
  const days = ["Mo", "Tu", "We", "Th", "Fr"];
  const windows: Array<[string, string]> = [
    ["09:00", "10:00"],
    ["11:00", "12:00"],
    ["13:00", "14:30"],
    ["14:00", "16:00"],
    ["16:00", "17:30"],
    ["18:00", "20:00"],
  ];

  const paths: string[] = [];
  for (let i = 0; i < 100; i++) {
    const slot = i % 10;
    if (slot < 5) {
      const day = days[i % days.length]!;
      const [start, end] = windows[i % windows.length]!;
      const buildingParam =
        i % 3 === 0 && buildings.length > 0
          ? `&building=${encodeURIComponent(buildings[i % buildings.length]!)}`
          : "";
      paths.push(
        `/api/rooms/search?term=${term}&day=${day}&start=${start}&end=${end}&minFreeMin=30${buildingParam}`
      );
    } else if (slot < 8) {
      const buildingParam =
        i % 4 === 0 && buildings.length > 0
          ? `&building=${encodeURIComponent(buildings[i % buildings.length]!)}`
          : "";
      paths.push(`/api/rooms/free-now?term=${term}&minFreeMin=30${buildingParam}`);
    } else if (roomIds.length > 0) {
      const roomId = roomIds[i % roomIds.length]!;
      paths.push(`/api/rooms/${roomId}/availability?term=${term}`);
    } else {
      paths.push(`/api/rooms/free-now?term=${term}`);
    }
  }
  return paths;
}

async function runRound(
  baseUrl: string,
  paths: readonly string[],
  totalRequests: number,
  concurrency: number
): Promise<RoundMetrics> {
  const latencies: number[] = [];
  let errors = 0;
  let nextIndex = 0;
  const roundStart = performance.now();

  const worker = async () => {
    while (nextIndex < totalRequests) {
      const idx = nextIndex++;
      const path = paths[idx % paths.length]!;
      const t0 = performance.now();
      try {
        const res = await fetch(`${baseUrl}${path}`);
        await res.arrayBuffer();
        const elapsed = performance.now() - t0;
        if (!res.ok) {
          errors += 1;
        } else {
          latencies.push(elapsed);
        }
      } catch {
        errors += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, totalRequests) }, () => worker()));

  const totalDurationMs = performance.now() - roundStart;
  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((acc, v) => acc + v, 0);

  return {
    concurrency,
    requests: totalRequests,
    errors,
    totalDurationMs: round2(totalDurationMs),
    rps: round2((totalRequests / totalDurationMs) * 1000),
    minMs: round2(latencies[0] ?? 0),
    meanMs: round2(latencies.length ? sum / latencies.length : 0),
    p50Ms: round2(percentile(latencies, 50)),
    p95Ms: round2(percentile(latencies, 95)),
    p99Ms: round2(percentile(latencies, 99)),
    maxMs: round2(latencies[latencies.length - 1] ?? 0),
  };
}

function printHumanReport(report: BenchmarkReport): void {
  console.log(`\nEmptyBoard Benchmark (${report.mode === "real" ? `real data/${report.term}.json` : `synthetic ${report.term}`})`);
  console.log(`Runtime: Node ${report.nodeVersion} (${report.platform})`);
  console.log(
    `Dataset: ${report.dataset.sections.toLocaleString()} sections | ` +
      `${report.dataset.meetings.toLocaleString()} meetings | ` +
      `${report.dataset.uniqueRooms.toLocaleString()} rooms across ` +
      `${report.dataset.uniqueBuildings} buildings | ` +
      `cold index build: ${report.dataset.coldIndexBuildMs.toFixed(2)} ms`
  );
  console.log("");
  console.log(
    "Concurrency | Requests | Errors |    RPS |  Min ms | Mean ms |  p50 ms |  p95 ms |  p99 ms |  Max ms"
  );
  console.log(
    "----------- | -------- | ------ | ------ | ------- | ------- | ------- | ------- | ------- | -------"
  );
  for (const r of report.rounds) {
    console.log(
      `${String(r.concurrency).padStart(11)} | ` +
        `${String(r.requests).padStart(8)} | ` +
        `${String(r.errors).padStart(6)} | ` +
        `${r.rps.toFixed(0).padStart(6)} | ` +
        `${r.minMs.toFixed(2).padStart(7)} | ` +
        `${r.meanMs.toFixed(2).padStart(7)} | ` +
        `${r.p50Ms.toFixed(2).padStart(7)} | ` +
        `${r.p95Ms.toFixed(2).padStart(7)} | ` +
        `${r.p99Ms.toFixed(2).padStart(7)} | ` +
        `${r.maxMs.toFixed(2).padStart(7)}`
    );
  }
  console.log(
    `\nMemory: RSS ${report.memoryMB.rss.toFixed(1)} MB | Heap ${report.memoryMB.heapUsed.toFixed(1)} MB`
  );
  console.log(
    `Assertions: sections >= ${report.minSectionsRequired.toLocaleString()}, errors == 0, p99 < ${report.thresholdP99Ms} ms -> ${report.passed ? "PASS" : "FAIL"}`
  );
}

async function main(): Promise<void> {
  const synthetic = hasFlag("synthetic");
  const jsonOutput = hasFlag("json");
  const requestsPerRound = parseIntArg("requests", 500, 10);
  const thresholdP99Ms = parseIntArg("max-p99", 200, 1);
  const minSectionsRequired = parseIntArg("min-sections", synthetic ? 10_000 : 1, 1);
  const concurrencyLevels = parseConcurrencyList(getArg("concurrency"));

  let tempDir: string | null = null;
  let dataDir: string;
  let term: string;

  const baseConfig = loadConfig({ EMPTYBOARD_LOG_LEVEL: "silent" });

  if (synthetic) {
    term = normalizeTermCode(getArg("term") ?? "SP26") ?? "SP26";
    const syntheticCount = parseIntArg("sections", 12_000, 100);
    tempDir = await mkdtemp(join(tmpdir(), "emptyboard-bench-"));
    dataDir = tempDir;
    const tempStore = new ScheduleStore({ dataDir, dailyWindow: baseConfig.dailyWindow });
    await tempStore.saveTermAtomic(term, generateSyntheticSections(term, syntheticCount));
  } else {
    dataDir = baseConfig.dataDir;
    const probeStore = new ScheduleStore({ dataDir, dailyWindow: baseConfig.dailyWindow });
    const termArg = getArg("term");
    if (termArg) {
      const normalized = normalizeTermCode(termArg);
      if (!normalized) throw new Error(`Invalid --term value: ${termArg}`);
      term = normalized;
    } else {
      const available = await probeStore.listAvailableTermsOnDisk();
      if (available.length === 0) {
        throw new Error(
          "No local schedule JSON found in data/. Run `npm run sync -- --term=SP26` first, or use `npm run bench:synthetic`."
        );
      }
      term = available[0]!;
    }
  }

  let server: ReturnType<typeof serve> | null = null;

  try {
    const config = loadConfig({
      EMPTYBOARD_DATA_DIR: dataDir,
      EMPTYBOARD_LOG_LEVEL: "silent",
    });
    const { app, store } = createApp({ config });

    const loaded = await store.getRoomIndex(term);
    if (!loaded) {
      throw new Error(
        `No local schedule found for ${term} in ${dataDir}. Run: npm run sync -- --term=${term}`
      );
    }

    const buildingsSet = new Set<string>();
    const roomIds: string[] = [];
    for (const room of loaded.index.rooms.values()) {
      buildingsSet.add(room.building);
      roomIds.push(room.roomId);
    }
    const buildings = [...buildingsSet].sort();

    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => {
      if (server!.listening) resolve();
      else server!.once("listening", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const workload = buildWorkloadPaths(term, roomIds, buildings);

    // Warmup V8 and HTTP sockets
    await runRound(baseUrl, workload, 60, 10);

    const rounds: RoundMetrics[] = [];
    for (const c of concurrencyLevels) {
      rounds.push(await runRound(baseUrl, workload, requestsPerRound, c));
    }

    const mem = process.memoryUsage();
    const scaleOk = loaded.index.sectionCount >= minSectionsRequired;
    const latencyOk = rounds.every((r) => r.errors === 0 && r.p99Ms < thresholdP99Ms);
    const passed = scaleOk && latencyOk;

    const report: BenchmarkReport = {
      mode: synthetic ? "synthetic" : "real",
      term,
      nodeVersion: process.version,
      platform: `${process.platform}/${process.arch}`,
      dataset: {
        sections: loaded.index.sectionCount,
        meetings: loaded.index.meetingCount,
        uniqueRooms: loaded.index.roomCount,
        uniqueBuildings: buildings.length,
        coldIndexBuildMs: round2(loaded.index.buildTimeMs),
      },
      thresholdP99Ms,
      minSectionsRequired,
      rounds,
      memoryMB: {
        rss: round2(mem.rss / (1024 * 1024)),
        heapUsed: round2(mem.heapUsed / (1024 * 1024)),
      },
      passed,
    };

    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHumanReport(report);
    }

    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
        if ("closeAllConnections" in server! && typeof server!.closeAllConnections === "function") {
          server!.closeAllConnections();
        }
      });
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

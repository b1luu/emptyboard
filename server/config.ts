import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LogLevel } from "./middleware/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");

export const DEFAULT_DATA_DIR = join(ROOT_DIR, "data");
export const DEFAULT_CLIENT_DIST_DIR = join(ROOT_DIR, "dist");

/** Default campus availability window: 08:00–22:00 Pacific time. */
export const DEFAULT_DAY_START_MIN = 8 * 60;
export const DEFAULT_DAY_END_MIN = 22 * 60;

export type DailyWindowConfig = {
  dayStartMin: number;
  dayEndMin: number;
};

export type AppConfig = {
  port: number;
  dataDir: string;
  clientDistDir: string;
  dailyWindow: DailyWindowConfig;
  socTimeoutMs: number;
  socMaxRetries: number;
  termsCacheTtlMs: number;
  syncConcurrency: number;
  logLevel: LogLevel;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = env.EMPTYBOARD_LOG_LEVEL?.trim().toLowerCase();
  if (raw === "info" || raw === "warn" || raw === "error" || raw === "silent") {
    return raw;
  }
  return env.NODE_ENV === "test" ? "silent" : "info";
}

export function dailyWindowFromEnv(env: NodeJS.ProcessEnv = process.env): DailyWindowConfig {
  const startRaw = env.EMPTYBOARD_DAY_START_MIN?.trim();
  const endRaw = env.EMPTYBOARD_DAY_END_MIN?.trim();
  if (startRaw && endRaw && /^\d+$/.test(startRaw) && /^\d+$/.test(endRaw)) {
    const start = Number.parseInt(startRaw, 10);
    const end = Number.parseInt(endRaw, 10);
    if (
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      end <= 24 * 60 &&
      end > start
    ) {
      return { dayStartMin: start, dayEndMin: end };
    }
  }
  return { dayStartMin: DEFAULT_DAY_START_MIN, dayEndMin: DEFAULT_DAY_END_MIN };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const concurrency = Math.min(8, parsePositiveInt(env.EMPTYBOARD_SYNC_CONCURRENCY, 6));
  return {
    port: parsePositiveInt(env.PORT, 3000),
    dataDir: env.EMPTYBOARD_DATA_DIR?.trim() || DEFAULT_DATA_DIR,
    clientDistDir: env.EMPTYBOARD_CLIENT_DIST_DIR?.trim() || DEFAULT_CLIENT_DIST_DIR,
    dailyWindow: dailyWindowFromEnv(env),
    socTimeoutMs: parsePositiveInt(env.EMPTYBOARD_SOC_TIMEOUT_MS, 12_000),
    socMaxRetries: Math.min(5, parseNonNegativeInt(env.EMPTYBOARD_SOC_MAX_RETRIES, 2)),
    termsCacheTtlMs: parsePositiveInt(env.EMPTYBOARD_TERMS_CACHE_TTL_MS, 60 * 60 * 1000),
    syncConcurrency: concurrency,
    logLevel: parseLogLevel(env),
  };
}

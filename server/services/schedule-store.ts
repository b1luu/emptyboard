import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DailyWindowConfig } from "../config";
import type { LoadedTermData, RoomAvailabilityIndex, SectionRow } from "../types/schedule";
import { buildRoomAvailabilityIndex } from "./availability";

const TERM_CODE_RE = /^[A-Z0-9]{4}$/;

export function normalizeTermCode(raw: string): string | null {
  const normalized = raw.trim().toUpperCase();
  return TERM_CODE_RE.test(normalized) ? normalized : null;
}

type CachedTermEntry = {
  data: LoadedTermData;
  fileSize: number;
  checkedAt: number;
};

export type ScheduleStoreStats = {
  loadedTerms: string[];
  totalSections: number;
  totalRooms: number;
};

export class ScheduleStore {
  private readonly dataDir: string;
  private readonly dailyWindow: DailyWindowConfig;
  private readonly statCheckIntervalMs: number;
  private readonly termCache = new Map<string, CachedTermEntry>();
  private readonly indexCache = new Map<string, RoomAvailabilityIndex>();
  private readonly inFlightLoads = new Map<string, Promise<LoadedTermData | null>>();

  constructor(opts: {
    dataDir: string;
    dailyWindow: DailyWindowConfig;
    statCheckIntervalMs?: number;
  }) {
    this.dataDir = opts.dataDir;
    this.dailyWindow = opts.dailyWindow;
    this.statCheckIntervalMs = opts.statCheckIntervalMs ?? 2_000;
  }

  getTermFilePath(term: string): string {
    const normalized = normalizeTermCode(term);
    if (!normalized) {
      throw new Error(`Invalid term code: ${term}`);
    }
    return join(this.dataDir, `${normalized}.json`);
  }

  loadTerm(term: string): Promise<LoadedTermData | null> {
    const normalized = normalizeTermCode(term);
    if (!normalized) return Promise.resolve(null);

    const cached = this.termCache.get(normalized);
    if (cached && Date.now() - cached.checkedAt < this.statCheckIntervalMs) {
      return Promise.resolve(cached.data);
    }

    const inFlight = this.inFlightLoads.get(normalized);
    if (inFlight) return inFlight;

    const loadPromise = this.loadTermFromDisk(normalized).finally(() => {
      this.inFlightLoads.delete(normalized);
    });
    this.inFlightLoads.set(normalized, loadPromise);
    return loadPromise;
  }

  private async loadTermFromDisk(normalized: string): Promise<LoadedTermData | null> {
    const filePath = join(this.dataDir, `${normalized}.json`);
    let mtimeMs: number;
    let fileSize: number;
    try {
      const info = await stat(filePath);
      mtimeMs = info.mtimeMs;
      fileSize = info.size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.termCache.delete(normalized);
        this.indexCache.delete(normalized);
        return null;
      }
      throw err;
    }

    const cached = this.termCache.get(normalized);
    if (cached && cached.data.loadedAt === mtimeMs && cached.fileSize === fileSize) {
      cached.checkedAt = Date.now();
      return cached.data;
    }

    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Schedule file for ${normalized} must contain a JSON array`);
    }

    // Avoid overwriting a newer cache entry populated concurrently by saveTermAtomic.
    const latest = this.termCache.get(normalized);
    if (latest && latest.data.loadedAt > mtimeMs) {
      return latest.data;
    }

    const data: LoadedTermData = {
      term: normalized,
      sections: parsed as SectionRow[],
      loadedAt: mtimeMs,
      sourcePath: filePath,
    };

    this.termCache.set(normalized, { data, fileSize, checkedAt: Date.now() });
    this.indexCache.delete(normalized);
    return data;
  }

  async getRoomIndex(
    term: string
  ): Promise<{ data: LoadedTermData; index: RoomAvailabilityIndex } | null> {
    const data = await this.loadTerm(term);
    if (!data) return null;

    let index = this.indexCache.get(data.term);
    if (!index) {
      index = buildRoomAvailabilityIndex(data.term, data.sections, this.dailyWindow);
      this.indexCache.set(data.term, index);
    }
    return { data, index };
  }

  /**
   * Persist sections via write-to-temp + rename so an interrupted sync
   * never corrupts or truncates the last-known-good schedule cache.
   */
  async saveTermAtomic(term: string, sections: SectionRow[]): Promise<LoadedTermData> {
    const filePath = this.getTermFilePath(term);
    const normalized = normalizeTermCode(term)!;
    await mkdir(this.dataDir, { recursive: true });

    const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(sections), "utf-8");
      await rename(tmpPath, filePath);
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }

    const info = await stat(filePath);
    const data: LoadedTermData = {
      term: normalized,
      sections,
      loadedAt: info.mtimeMs,
      sourcePath: filePath,
    };

    this.termCache.set(normalized, {
      data,
      fileSize: info.size,
      checkedAt: Date.now(),
    });
    this.indexCache.set(
      normalized,
      buildRoomAvailabilityIndex(normalized, sections, this.dailyWindow)
    );
    return data;
  }

  invalidate(term?: string): void {
    if (term) {
      const normalized = normalizeTermCode(term);
      if (normalized) {
        this.termCache.delete(normalized);
        this.indexCache.delete(normalized);
      }
      return;
    }
    this.termCache.clear();
    this.indexCache.clear();
  }

  async listAvailableTermsOnDisk(): Promise<string[]> {
    try {
      const entries = await readdir(this.dataDir);
      const terms: string[] = [];
      for (const name of entries) {
        if (!name.endsWith(".json")) continue;
        const base = name.slice(0, -5);
        const normalized = normalizeTermCode(base);
        if (normalized) terms.push(normalized);
      }
      return terms.sort().reverse();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  getStats(): ScheduleStoreStats {
    const loadedTerms = [...this.termCache.keys()].sort();
    let totalSections = 0;
    let totalRooms = 0;

    for (const term of loadedTerms) {
      totalSections += this.termCache.get(term)?.data.sections.length ?? 0;
      totalRooms += this.indexCache.get(term)?.roomCount ?? 0;
    }

    return { loadedTerms, totalSections, totalRooms };
  }
}

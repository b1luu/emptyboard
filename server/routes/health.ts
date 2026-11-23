import type { Handler } from "hono";
import type { AppEnv } from "../app";
import type { AppConfig } from "../config";
import type { ScheduleStore } from "../services/schedule-store";

export function createHealthHandler(config: AppConfig, store: ScheduleStore): Handler<AppEnv> {
  return async (c) => {
    const stats = store.getStats();
    const availableTermsOnDisk = await store.listAvailableTermsOnDisk();

    return c.json({
      ok: true,
      status: "ok",
      service: "emptyboard",
      mode: "room-availability",
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      dailyWindow: {
        startMin: config.dailyWindow.dayStartMin,
        endMin: config.dailyWindow.dayEndMin,
      },
      index: {
        loadedTerms: stats.loadedTerms,
        availableTermsOnDisk,
        totalSections: stats.totalSections,
        totalRooms: stats.totalRooms,
        termCacheHits: stats.termCacheHits,
        termCacheMisses: stats.termCacheMisses,
      },
    });
  };
}

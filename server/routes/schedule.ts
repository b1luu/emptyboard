import { Hono } from "hono";
import { ApiError, internalError, notFound, upstreamError } from "../errors";
import type { ScheduleStore } from "../services/schedule-store";
import { ScheduleSyncError, type ScheduleSyncService } from "../services/schedule-sync";
import { UpstreamSocError } from "../soc/client";
import { parseSubjectsQuery, parseTermCode } from "../validation";

const MAX_SUBJECTS_PER_SYNC = 25;

function isFilesystemError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as NodeJS.ErrnoException).code === "string" &&
    "syscall" in err
  );
}

export function createScheduleRoutes(
  store: ScheduleStore,
  syncService: ScheduleSyncService
): Hono {
  const router = new Hono();

  router.get("/:term", async (c) => {
    const term = parseTermCode(c.req.param("term"), "term", "BAD_REQUEST");

    const data = await store.loadTerm(term);
    if (!data) {
      throw notFound(`No local index for ${term}. Run: npm run sync -- --term=${term}`, { term });
    }

    return c.json({
      term: data.term,
      count: data.sections.length,
      loadedAt: data.loadedAt,
      sections: data.sections,
    });
  });

  router.post("/:term/sync", async (c) => {
    const term = parseTermCode(c.req.param("term"), "term", "BAD_REQUEST");
    const subjects = parseSubjectsQuery(c.req.query("subjects"), MAX_SUBJECTS_PER_SYNC);

    try {
      const summary = await syncService.syncTerm(term, { subjects });
      return c.json({
        synced: true,
        term: summary.term,
        subjectsRequested: summary.subjectsRequested,
        subjectsSucceeded: summary.subjectsSucceeded,
        failedSubjects: summary.failedSubjects,
        sectionCount: summary.sectionCount,
        durationMs: summary.durationMs,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }

      if (err instanceof UpstreamSocError || err instanceof ScheduleSyncError) {
        const existing = await store.loadTerm(term).catch(() => null);
        throw upstreamError(
          `Unable to sync schedule for ${term}`,
          {
            term,
            ...(err instanceof UpstreamSocError && err.status !== undefined
              ? { upstreamStatus: err.status }
              : {}),
            fallbackAvailable: existing !== null,
            cachedSectionCount: existing?.sections.length ?? 0,
          },
          { cause: err }
        );
      }

      if (isFilesystemError(err)) {
        const existing = await store.loadTerm(term).catch(() => null);
        throw internalError(
          "Unable to persist synced schedule",
          {
            term,
            fallbackAvailable: existing !== null,
            cachedSectionCount: existing?.sections.length ?? 0,
          },
          { cause: err }
        );
      }

      throw err;
    }
  });

  return router;
}

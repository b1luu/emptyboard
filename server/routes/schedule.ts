import { Hono } from "hono";
import { normalizeTermCode, type ScheduleStore } from "../services/schedule-store";
import { parseSubjectCodes, type ScheduleSyncService } from "../services/schedule-sync";

const MAX_SUBJECTS_PER_SYNC = 25;

export function createScheduleRoutes(
  store: ScheduleStore,
  syncService: ScheduleSyncService
): Hono {
  const router = new Hono();

  router.get("/:term", async (c) => {
    const term = normalizeTermCode(c.req.param("term"));
    if (!term) {
      return c.json({ error: "invalid term code (expected 4 alphanumeric chars, e.g. SP26)" }, 400);
    }

    const t0 = performance.now();
    const data = await store.loadTerm(term);
    if (!data) {
      return c.json(
        { error: `No local index for ${term}. Run: npm run sync -- --term=${term}` },
        404
      );
    }

    const ms = performance.now() - t0;
    c.header("X-Response-Time", `${ms.toFixed(2)}ms`);
    c.header("Server-Timing", `schedule;dur=${ms.toFixed(1)}`);

    return c.json({
      term: data.term,
      count: data.sections.length,
      loadedAt: data.loadedAt,
      sections: data.sections,
    });
  });

  router.post("/:term/sync", async (c) => {
    const term = normalizeTermCode(c.req.param("term"));
    if (!term) {
      return c.json({ error: "invalid term code (expected 4 alphanumeric chars, e.g. SP26)" }, 400);
    }

    const subjectsQuery = c.req.query("subjects");
    let subjects: string[] | undefined;
    if (subjectsQuery !== undefined) {
      const parsed = parseSubjectCodes(subjectsQuery, MAX_SUBJECTS_PER_SYNC);
      if (!parsed.ok) {
        return c.json({ error: parsed.error }, 400);
      }
      subjects = parsed.subjects;
    }

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
      const existing = await store.loadTerm(term).catch(() => null);
      return c.json(
        {
          error: err instanceof Error ? err.message : String(err),
          fallbackAvailable: existing !== null,
          cachedSectionCount: existing?.sections.length ?? 0,
        },
        502
      );
    }
  });

  return router;
}

import { Hono } from "hono";
import type { ScheduleSyncService } from "../services/schedule-sync";

export function createTermsRoutes(syncService: ScheduleSyncService): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    try {
      const result = await syncService.getTerms();
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return router;
}

import { Hono } from "hono";
import { ApiError, upstreamError } from "../errors";
import type { ScheduleSyncService } from "../services/schedule-sync";
import { UpstreamSocError } from "../soc/client";

export function createTermsRoutes(syncService: ScheduleSyncService): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    try {
      const result = await syncService.getTerms();
      return c.json(result);
    } catch (err) {
      if (err instanceof ApiError || err instanceof UpstreamSocError) {
        throw err;
      }
      throw upstreamError("Unable to load UCSD terms", undefined, { cause: err });
    }
  });

  return router;
}

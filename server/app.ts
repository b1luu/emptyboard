import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadConfig, type AppConfig } from "./config";
import { createRoomsRoutes } from "./routes/rooms";
import { createScheduleRoutes } from "./routes/schedule";
import { registerStaticRoutes } from "./routes/static";
import { createTermsRoutes } from "./routes/terms";
import { ScheduleStore } from "./services/schedule-store";
import { ScheduleSyncService } from "./services/schedule-sync";
import { createSocClient, type SocClient } from "./soc/client";

export type AppDependencies = {
  config?: AppConfig;
  socClient?: SocClient;
  store?: ScheduleStore;
  syncService?: ScheduleSyncService;
};

export type EmptyBoardApp = {
  app: Hono;
  config: AppConfig;
  store: ScheduleStore;
  syncService: ScheduleSyncService;
};

export function createApp(deps: AppDependencies = {}): EmptyBoardApp {
  const config = deps.config ?? loadConfig();
  const socClient =
    deps.socClient ??
    createSocClient({
      timeoutMs: config.socTimeoutMs,
      maxRetries: config.socMaxRetries,
    });
  const store =
    deps.store ??
    new ScheduleStore({
      dataDir: config.dataDir,
      dailyWindow: config.dailyWindow,
    });
  const syncService =
    deps.syncService ??
    new ScheduleSyncService({
      socClient,
      store,
      termsCacheTtlMs: config.termsCacheTtlMs,
      defaultConcurrency: config.syncConcurrency,
    });

  const app = new Hono();

  app.use("/api/*", cors());

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "emptyboard", mode: "room-availability" })
  );

  app.route("/api/terms", createTermsRoutes(syncService));
  app.route("/api/schedule", createScheduleRoutes(store, syncService));
  app.route("/api/rooms", createRoomsRoutes(store));

  registerStaticRoutes(app, config.clientDistDir);

  return { app, config, store, syncService };
}

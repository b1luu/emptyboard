import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadConfig, type AppConfig } from "./config";
import {
  ApiError,
  formatErrorEnvelope,
  internalError,
  notFound,
  upstreamError,
} from "./errors";
import { createRoomsRoutes } from "./routes/rooms";
import { createScheduleRoutes } from "./routes/schedule";
import { registerStaticRoutes } from "./routes/static";
import { createTermsRoutes } from "./routes/terms";
import { ScheduleStore } from "./services/schedule-store";
import { ScheduleSyncService } from "./services/schedule-sync";
import { createSocClient, UpstreamSocError, type SocClient } from "./soc/client";

export type AppEnv = {
  Variables: {
    requestId?: string;
  };
};

export type AppDependencies = {
  config?: AppConfig;
  socClient?: SocClient;
  store?: ScheduleStore;
  syncService?: ScheduleSyncService;
};

export type EmptyBoardApp = {
  app: Hono<AppEnv>;
  config: AppConfig;
  store: ScheduleStore;
  syncService: ScheduleSyncService;
};

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

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

  const app = new Hono<AppEnv>();

  app.use("/api/*", cors());

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? null;

    if (err instanceof ApiError) {
      return c.json(formatErrorEnvelope(err, requestId), err.status);
    }

    if (err instanceof UpstreamSocError) {
      const mapped = upstreamError(
        "Upstream UCSD schedule service is currently unavailable",
        err.status !== undefined ? { upstreamStatus: err.status } : undefined
      );
      return c.json(formatErrorEnvelope(mapped, requestId), mapped.status);
    }

    const mapped = internalError();
    return c.json(formatErrorEnvelope(mapped, requestId), mapped.status);
  });

  app.notFound((c) => {
    const pathname = new URL(c.req.url).pathname;
    if (isApiPath(pathname)) {
      const requestId = c.get("requestId") ?? null;
      const err = notFound(`Route not found: ${c.req.method} ${pathname}`);
      return c.json(formatErrorEnvelope(err, requestId), err.status);
    }
    return c.text("Not Found", 404);
  });

  app.get("/api/health", (c) =>
    c.json({ ok: true, service: "emptyboard", mode: "room-availability" })
  );

  app.route("/api/terms", createTermsRoutes(syncService));
  app.route("/api/schedule", createScheduleRoutes(store, syncService));
  app.route("/api/rooms", createRoomsRoutes(store));

  registerStaticRoutes(app, config.clientDistDir);

  return { app, config, store, syncService };
}

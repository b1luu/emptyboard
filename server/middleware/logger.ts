import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { AppEnv } from "../app";

export type LogLevel = "info" | "warn" | "error" | "silent";
export type ActiveLogLevel = Exclude<LogLevel, "silent">;

export type LogEntry = Record<string, unknown>;
export type LogSink = (entry: LogEntry, level: ActiveLogLevel) => void;

const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  info: 10,
  warn: 20,
  error: 30,
  silent: 100,
};

export function defaultLogSink(entry: LogEntry, level: ActiveLogLevel): void {
  const line = `${JSON.stringify(entry)}\n`;
  if (level === "error") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export function shouldLog(configured: LogLevel, messageLevel: ActiveLogLevel): boolean {
  return LEVEL_PRIORITY[messageLevel] >= LEVEL_PRIORITY[configured];
}

function safeWriteLog(sink: LogSink, entry: LogEntry, level: ActiveLogLevel): void {
  try {
    sink(entry, level);
  } catch {
    // Logging failures must never disrupt or alter HTTP responses.
  }
}

export function resolveRequestId(incoming: string | undefined): string {
  if (incoming) {
    const trimmed = incoming.trim();
    if (SAFE_REQUEST_ID_RE.test(trimmed)) return trimmed;
  }
  return randomUUID();
}

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
};

export function serializeErrorForLog(err: unknown, depth = 0): SerializedError {
  if (err instanceof Error) {
    const serialized: SerializedError = {
      name: err.name,
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
    };
    if ("cause" in err && err.cause !== undefined && depth < 4) {
      serialized.cause =
        err.cause instanceof Error
          ? serializeErrorForLog(err.cause, depth + 1)
          : String(err.cause);
    }
    return serialized;
  }
  return {
    name: "NonErrorThrown",
    message: String(err),
  };
}

export function logServerError(
  opts: { level: LogLevel; sink: LogSink },
  details: {
    requestId: string | null;
    method: string;
    path: string;
    status: number;
    err: unknown;
  }
): void {
  if (!shouldLog(opts.level, "error")) return;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level: "error",
    event: "http_error",
    requestId: details.requestId,
    method: details.method,
    path: details.path,
    status: details.status,
    error: serializeErrorForLog(details.err),
  };

  safeWriteLog(opts.sink, entry, "error");
}

export function createRequestLogger(opts: {
  level: LogLevel;
  sink?: LogSink;
}): MiddlewareHandler<AppEnv> {
  const sink = opts.sink ?? defaultLogSink;

  return async (c, next) => {
    const requestId = resolveRequestId(c.req.header("x-request-id"));
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);

    const t0 = performance.now();
    await next();
    const durationMs = Number((performance.now() - t0).toFixed(2));

    c.res.headers.set("X-Request-Id", requestId);
    c.res.headers.set("X-Response-Time", `${durationMs.toFixed(2)}ms`);
    if (!c.res.headers.has("Server-Timing")) {
      c.res.headers.set("Server-Timing", `http;dur=${durationMs.toFixed(1)}`);
    }

    const status = c.res.status;
    const level: ActiveLogLevel = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    if (!shouldLog(opts.level, level)) return;

    const pathname = new URL(c.req.url).pathname;
    const matchedRoute = routePath(c);
    const route = !matchedRoute || matchedRoute.includes("*") ? pathname : matchedRoute;

    safeWriteLog(
      sink,
      {
        ts: new Date().toISOString(),
        level,
        event: "http_request",
        requestId,
        method: c.req.method,
        route,
        path: pathname,
        status,
        durationMs,
      },
      level
    );
  };
}

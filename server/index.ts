import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { partsFromRoomId } from "./meeting-model";
import {
  buildRoomAvailabilityIndex,
  getRoomAvailabilityDetail,
  nowPacific,
  parseWindowFromQuery,
  roomsFreeNow,
  searchRoomsFreeInWindow,
  type RoomAvailabilityIndex,
} from "./room-availability";
import { tryLoadTerm } from "./store";
import { fetchTermsFromStudentPage } from "./soc-fetch";
import type { SectionRow } from "./types";
import { ROOT_DIR } from "./paths";
import { dailyWindowFromEnv } from "./window-env";
import { formatMinutes, parseDayQuery } from "./time-util";

const app = new Hono();

app.use("/api/*", cors());

const sectionCache = new Map<string, { sections: SectionRow[]; loadedAt: number; sourcePath: string }>();
const roomIndexCache = new Map<string, RoomAvailabilityIndex>();

async function getTermData(term: string) {
  const hit = sectionCache.get(term);
  if (hit) return hit;
  const loaded = await tryLoadTerm(term);
  if (!loaded) return null;
  sectionCache.set(term, loaded);
  return loaded;
}

function getRoomIndex(term: string, sections: SectionRow[]): RoomAvailabilityIndex {
  let idx = roomIndexCache.get(term);
  if (!idx) {
    idx = buildRoomAvailabilityIndex(term, sections, dailyWindowFromEnv());
    roomIndexCache.set(term, idx);
  }
  return idx;
}

function timing(c: { header: (n: string, v: string) => void }, t0: number) {
  const ms = performance.now() - t0;
  c.header("X-Response-Time", `${ms.toFixed(2)}ms`);
  c.header("Server-Timing", `room;dur=${ms.toFixed(1)}`);
}

app.get("/api/health", (c) => c.json({ ok: true, service: "emptyboard", mode: "room-availability" }));

app.get("/api/terms", async (c) => {
  try {
    const terms = await fetchTermsFromStudentPage();
    return c.json({ terms });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

app.get("/api/schedule/:term", async (c) => {
  const term = c.req.param("term");
  const t0 = performance.now();
  const data = await getTermData(term);
  if (!data) {
    return c.json(
      {
        error: `No local index for ${term}. Run: npm run sync -- --term=${term}`,
      },
      404
    );
  }
  timing(c, t0);
  return c.json({
    term,
    count: data.sections.length,
    loadedAt: data.loadedAt,
    sourcePath: data.sourcePath,
    sections: data.sections,
  });
});

app.get("/api/rooms/free-now", async (c) => {
  const term = c.req.query("term") ?? "";
  if (!term) return c.json({ error: "missing term" }, 400);
  const t0 = performance.now();
  const data = await getTermData(term);
  if (!data) return c.json({ error: `No local index for ${term}` }, 404);

  const building = c.req.query("building") ?? undefined;
  const minFree = c.req.query("minFreeMin");
  const minFreeMin = minFree ? parseInt(minFree, 10) : 0;
  const whiteboard = c.req.query("whiteboard");

  const idx = getRoomIndex(term, data.sections);
  const { now, rows, campusDay } = roomsFreeNow(idx, {
    buildingPrefix: building,
    minFreeMin: Number.isFinite(minFreeMin) ? minFreeMin : 0,
  });

  timing(c, t0);
  return c.json({
    term,
    timezone: "America/Los_Angeles",
    now,
    campusDay,
    count: rows.length,
    whiteboardPlaceholder: whiteboard === "1" || whiteboard === "true",
    rooms: rows,
  });
});

app.get("/api/rooms/search", async (c) => {
  const term = c.req.query("term") ?? "";
  const day = c.req.query("day") ?? "";
  const start = c.req.query("start") ?? undefined;
  const end = c.req.query("end") ?? undefined;
  if (!term) return c.json({ error: "missing term" }, 400);
  if (!day) return c.json({ error: "missing day" }, 400);

  const win = parseWindowFromQuery(start, end);
  if (!win) return c.json({ error: "missing or invalid start/end (use HH:MM 24h or 2:00p)" }, 400);

  const t0 = performance.now();
  const data = await getTermData(term);
  if (!data) return c.json({ error: `No local index for ${term}` }, 404);

  const building = c.req.query("building") ?? undefined;
  const minFree = c.req.query("minFreeMin");
  const minFreeMin = minFree ? parseInt(minFree, 10) : 0;
  const whiteboard = c.req.query("whiteboard");

  const idx = getRoomIndex(term, data.sections);
  const np = nowPacific();
  const qDay = parseDayQuery(day);
  if (!qDay) return c.json({ error: "invalid day (e.g. Tu, Th, M, R)" }, 400);

  const today = np.day !== null && np.day === qDay;
  const rooms = searchRoomsFreeInWindow(idx, {
    day: qDay,
    windowStart: win.start,
    windowEnd: win.end,
    buildingPrefix: building,
    minFreeMin: Number.isFinite(minFreeMin) ? minFreeMin : 0,
    nowMinutes: today ? np.minutes : undefined,
    nowDay: today ? qDay : undefined,
  });

  timing(c, t0);
  return c.json({
    term,
    day: qDay,
    window: {
      startMin: win.start,
      endMin: win.end,
      startLabel: formatMinutes(win.start),
      endLabel: formatMinutes(win.end),
    },
    count: rooms.length,
    whiteboardPlaceholder: whiteboard === "1" || whiteboard === "true",
    rooms,
  });
});

app.get("/api/rooms/:roomId/availability", async (c) => {
  const term = c.req.query("term") ?? "";
  if (!term) return c.json({ error: "missing term" }, 400);
  const roomId = c.req.param("roomId");
  const parts = partsFromRoomId(roomId);
  if (!parts) return c.json({ error: "invalid room id" }, 400);

  const t0 = performance.now();
  const data = await getTermData(term);
  if (!data) return c.json({ error: `No local index for ${term}` }, 404);

  const idx = getRoomIndex(term, data.sections);
  const detail = getRoomAvailabilityDetail(idx, parts.building, parts.room);
  if (!detail) return c.json({ error: "room not found in index" }, 404);

  timing(c, t0);
  return c.json({
    term,
    building: detail.building,
    room: detail.room,
    roomId: detail.roomId,
    dailyWindow: { startMin: idx.dayStartMin, endMin: idx.dayEndMin },
    schedule: detail.byDay,
  });
});

const clientDist = join(ROOT_DIR, "dist");
const clientIndex = join(clientDist, "index.html");

function contentType(path: string): string {
  const e = extname(path).toLowerCase();
  const m: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
  };
  return m[e] ?? "application/octet-stream";
}

app.get("*", async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (pathname.startsWith("/api")) {
    return c.notFound();
  }
  if (!existsSync(clientIndex)) {
    return c.text(
      "EmptyBoard API — run `npm run build` for the UI, or `npm run dev` (Vite proxies /api to this server).",
      200,
      { "Content-Type": "text/plain; charset=utf-8" }
    );
  }
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  if (rel.includes("..")) {
    return c.text("bad path", 400);
  }
  const filePath = join(clientDist, rel);
  if (existsSync(filePath)) {
    const buf = await readFile(filePath);
    return c.body(buf, 200, { "Content-Type": contentType(filePath) });
  }
  const html = await readFile(clientIndex, "utf-8");
  return c.html(html);
});

const port = parseInt(process.env.PORT ?? "3000", 10);

serve({ fetch: app.fetch, port });
console.log(`EmptyBoard listening on http://localhost:${port}`);

export default app;

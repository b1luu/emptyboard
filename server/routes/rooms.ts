import { Hono } from "hono";
import {
  findRoomsFreeNow,
  getRoomAvailabilityDetail,
  searchRoomsInWindow,
} from "../services/availability";
import { normalizeTermCode, type ScheduleStore } from "../services/schedule-store";
import {
  formatMinutes,
  nowPacific,
  parseDayQuery,
  parseTimeWindow,
} from "../services/time-window";
import { partsFromRoomId } from "../types/schedule";

function setTimingHeaders(c: { header: (name: string, value: string) => void }, t0: number): void {
  const ms = performance.now() - t0;
  c.header("X-Response-Time", `${ms.toFixed(2)}ms`);
  c.header("Server-Timing", `room;dur=${ms.toFixed(1)}`);
}

export function createRoomsRoutes(store: ScheduleStore): Hono {
  const router = new Hono();

  router.get("/free-now", async (c) => {
    const rawTerm = c.req.query("term") ?? "";
    if (!rawTerm) return c.json({ error: "missing term" }, 400);

    const term = normalizeTermCode(rawTerm);
    if (!term) return c.json({ error: "invalid term code (e.g. SP26)" }, 400);

    const t0 = performance.now();
    const loaded = await store.getRoomIndex(term);
    if (!loaded) return c.json({ error: `No local index for ${term}` }, 404);

    const building = c.req.query("building") ?? undefined;
    const minFreeRaw = c.req.query("minFreeMin");
    const minFreeMin = minFreeRaw ? Number.parseInt(minFreeRaw, 10) : 0;
    const whiteboard = c.req.query("whiteboard");

    const { now, rows, campusDay } = findRoomsFreeNow(loaded.index, {
      buildingFilter: building,
      minFreeMin: Number.isFinite(minFreeMin) && minFreeMin >= 0 ? minFreeMin : 0,
    });

    setTimingHeaders(c, t0);
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

  router.get("/search", async (c) => {
    const rawTerm = c.req.query("term") ?? "";
    const rawDay = c.req.query("day") ?? "";
    const start = c.req.query("start") ?? undefined;
    const end = c.req.query("end") ?? undefined;

    if (!rawTerm) return c.json({ error: "missing term" }, 400);
    const term = normalizeTermCode(rawTerm);
    if (!term) return c.json({ error: "invalid term code (e.g. SP26)" }, 400);
    if (!rawDay) return c.json({ error: "missing day" }, 400);

    const dayCode = parseDayQuery(rawDay);
    if (!dayCode) return c.json({ error: "invalid day (e.g. Tu, Th, M, R)" }, 400);

    const window = parseTimeWindow(start, end);
    if (!window) {
      return c.json({ error: "missing or invalid start/end (use HH:MM 24h or 2:00p)" }, 400);
    }

    const t0 = performance.now();
    const loaded = await store.getRoomIndex(term);
    if (!loaded) return c.json({ error: `No local index for ${term}` }, 404);

    const building = c.req.query("building") ?? undefined;
    const minFreeRaw = c.req.query("minFreeMin");
    const minFreeMin = minFreeRaw ? Number.parseInt(minFreeRaw, 10) : 0;
    const whiteboard = c.req.query("whiteboard");

    const now = nowPacific();
    const isToday = now.day !== null && now.day === dayCode;

    const rooms = searchRoomsInWindow(loaded.index, {
      day: dayCode,
      windowStart: window.startMin,
      windowEnd: window.endMin,
      buildingFilter: building,
      minFreeMin: Number.isFinite(minFreeMin) && minFreeMin >= 0 ? minFreeMin : 0,
      nowMinutes: isToday ? now.minutes : undefined,
      nowDay: isToday ? dayCode : undefined,
    });

    setTimingHeaders(c, t0);
    return c.json({
      term,
      day: dayCode,
      window: {
        startMin: window.startMin,
        endMin: window.endMin,
        startLabel: formatMinutes(window.startMin),
        endLabel: formatMinutes(window.endMin),
      },
      count: rooms.length,
      whiteboardPlaceholder: whiteboard === "1" || whiteboard === "true",
      rooms,
    });
  });

  router.get("/:roomId/availability", async (c) => {
    const rawTerm = c.req.query("term") ?? "";
    if (!rawTerm) return c.json({ error: "missing term" }, 400);

    const term = normalizeTermCode(rawTerm);
    if (!term) return c.json({ error: "invalid term code (e.g. SP26)" }, 400);

    const roomId = c.req.param("roomId");
    const parts = partsFromRoomId(roomId);
    if (!parts) return c.json({ error: "invalid room id" }, 400);

    const t0 = performance.now();
    const loaded = await store.getRoomIndex(term);
    if (!loaded) return c.json({ error: `No local index for ${term}` }, 404);

    const detail = getRoomAvailabilityDetail(loaded.index, parts.building, parts.room);
    if (!detail) return c.json({ error: "room not found in index" }, 404);

    setTimingHeaders(c, t0);
    return c.json({
      term,
      building: detail.building,
      room: detail.room,
      roomId: detail.roomId,
      dailyWindow: {
        startMin: loaded.index.dayStartMin,
        endMin: loaded.index.dayEndMin,
      },
      schedule: detail.byDay,
    });
  });

  return router;
}

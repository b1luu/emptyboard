import { Hono } from "hono";
import { notFound } from "../errors";
import {
  findRoomsFreeNow,
  getRoomAvailabilityDetail,
  searchRoomsInWindow,
} from "../services/availability";
import type { ScheduleStore } from "../services/schedule-store";
import { formatMinutes, nowPacific } from "../services/time-window";
import {
  parseBooleanFlag,
  parseBuildingFilter,
  parseDayCode,
  parseRoomId,
  parseStrictNonNegativeInt,
  parseTermCode,
  parseTimeWindow,
} from "../validation";

export function createRoomsRoutes(store: ScheduleStore): Hono {
  const router = new Hono();

  router.get("/free-now", async (c) => {
    const term = parseTermCode(c.req.query("term"));
    const building = parseBuildingFilter(c.req.query("building"));
    const minFreeMin = parseStrictNonNegativeInt(c.req.query("minFreeMin"), {
      field: "minFreeMin",
      defaultValue: 0,
      max: 24 * 60,
    });
    const whiteboardPlaceholder = parseBooleanFlag(c.req.query("whiteboard"), "whiteboard");

    const loaded = await store.getRoomIndex(term);
    if (!loaded) {
      throw notFound(`No local index for ${term}`, { term });
    }

    const { now, rows, campusDay } = findRoomsFreeNow(loaded.index, {
      buildingFilter: building,
      minFreeMin,
    });

    return c.json({
      term,
      timezone: "America/Los_Angeles",
      now,
      campusDay,
      count: rows.length,
      whiteboardPlaceholder,
      rooms: rows,
    });
  });

  router.get("/search", async (c) => {
    const term = parseTermCode(c.req.query("term"));
    const dayCode = parseDayCode(c.req.query("day"));
    const window = parseTimeWindow(c.req.query("start"), c.req.query("end"));
    const building = parseBuildingFilter(c.req.query("building"));
    const minFreeMin = parseStrictNonNegativeInt(c.req.query("minFreeMin"), {
      field: "minFreeMin",
      defaultValue: 0,
      max: 24 * 60,
    });
    const whiteboardPlaceholder = parseBooleanFlag(c.req.query("whiteboard"), "whiteboard");

    const loaded = await store.getRoomIndex(term);
    if (!loaded) {
      throw notFound(`No local index for ${term}`, { term });
    }

    const now = nowPacific();
    const isToday = now.day !== null && now.day === dayCode;

    const rooms = searchRoomsInWindow(loaded.index, {
      day: dayCode,
      windowStart: window.startMin,
      windowEnd: window.endMin,
      buildingFilter: building,
      minFreeMin,
      nowMinutes: isToday ? now.minutes : undefined,
      nowDay: isToday ? dayCode : undefined,
    });

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
      whiteboardPlaceholder,
      rooms,
    });
  });

  router.get("/:roomId/availability", async (c) => {
    const term = parseTermCode(c.req.query("term"));
    const parts = parseRoomId(c.req.param("roomId"));

    const loaded = await store.getRoomIndex(term);
    if (!loaded) {
      throw notFound(`No local index for ${term}`, { term });
    }

    const detail = getRoomAvailabilityDetail(loaded.index, parts.building, parts.room);
    if (!detail) {
      throw notFound("Room not found in index", { term, building: parts.building, room: parts.room });
    }

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

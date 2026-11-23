import { badRequest, type ApiErrorCode } from "./errors";
import { normalizeTermCode } from "./services/schedule-store";
import { parseSubjectCodes } from "./services/schedule-sync";
import { parseClockFlexible, parseDayQuery } from "./services/time-window";
import { partsFromRoomId, roomIdFromParts, type DayCode, type Interval } from "./types/schedule";

const CLOCK_INPUT_RE = /^\d{1,2}:\d{2}\s*(am|pm|a|p)?$/i;
const SAFE_BUILDING_RE = /^[A-Za-z0-9 ._-]+$/;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
const CONTROL_CHAR_GLOBAL_RE = /[\x00-\x1f\x7f]/g;
const MAX_BUILDING_LEN = 40;
const MAX_ROOM_ID_LEN = 128;
const MAX_ECHO_LEN = 64;

function sanitizeReceived(value: string): string {
  const cleaned = value.replace(CONTROL_CHAR_GLOBAL_RE, "");
  return cleaned.length > MAX_ECHO_LEN ? `${cleaned.slice(0, MAX_ECHO_LEN)}...` : cleaned;
}

export function parseTermCode(
  raw: string | undefined,
  field = "term",
  code: ApiErrorCode = "INVALID_QUERY"
): string {
  if (raw === undefined || raw.trim() === "") {
    throw badRequest(`Missing required parameter: ${field}`, { field }, code);
  }
  const normalized = normalizeTermCode(raw);
  if (!normalized) {
    throw badRequest(
      `Invalid ${field}: expected a UCSD term code such as SP26, WI26, FA26, or S126`,
      { field, received: sanitizeReceived(raw) },
      code
    );
  }
  return normalized;
}

export function parseDayCode(raw: string | undefined, field = "day"): DayCode {
  if (raw === undefined || raw.trim() === "") {
    throw badRequest(`Missing required parameter: ${field}`, { field }, "INVALID_QUERY");
  }
  const day = parseDayQuery(raw);
  if (!day) {
    throw badRequest(
      `Invalid ${field}: expected a weekday code (M, Tu, W, Th, F, Sa)`,
      { field, received: sanitizeReceived(raw) },
      "INVALID_QUERY"
    );
  }
  return day;
}

export function parseClockTime(raw: string | undefined, field: string): number {
  if (raw === undefined || raw.trim() === "") {
    throw badRequest(`Missing required parameter: ${field}`, { field }, "INVALID_QUERY");
  }
  const trimmed = raw.trim();
  if (!CLOCK_INPUT_RE.test(trimmed)) {
    throw badRequest(
      `Invalid ${field}: use 24-hour HH:MM (e.g. 14:00) or 12-hour clock (e.g. 2:00p)`,
      { field, received: sanitizeReceived(raw) },
      "INVALID_QUERY"
    );
  }
  const minutes = parseClockFlexible(trimmed);
  if (minutes === null) {
    throw badRequest(
      `Invalid ${field}: use 24-hour HH:MM (e.g. 14:00) or 12-hour clock (e.g. 2:00p)`,
      { field, received: sanitizeReceived(raw) },
      "INVALID_QUERY"
    );
  }
  return minutes;
}

export function parseTimeWindow(
  startRaw: string | undefined,
  endRaw: string | undefined
): Interval {
  const startMin = parseClockTime(startRaw, "start");
  const endMin = parseClockTime(endRaw, "end");
  if (endMin <= startMin) {
    throw badRequest(
      "Invalid time window: end time must be strictly after start time",
      {
        fields: ["start", "end"],
        start: sanitizeReceived(startRaw ?? ""),
        end: sanitizeReceived(endRaw ?? ""),
      },
      "INVALID_QUERY"
    );
  }
  return { startMin, endMin };
}

export function parseStrictNonNegativeInt(
  raw: string | undefined,
  opts: { field: string; defaultValue?: number; max?: number }
): number {
  const { field, defaultValue = 0, max } = opts;
  if (raw === undefined) return defaultValue;

  if (!/^\d+$/.test(raw)) {
    throw badRequest(
      `Invalid ${field}: must be a non-negative integer`,
      { field, received: sanitizeReceived(raw) },
      "INVALID_QUERY"
    );
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || (max !== undefined && value > max)) {
    throw badRequest(
      max !== undefined
        ? `Invalid ${field}: must be an integer between 0 and ${max}`
        : `Invalid ${field}: integer out of safe range`,
      { field, received: sanitizeReceived(raw), ...(max !== undefined ? { max } : {}) },
      "INVALID_QUERY"
    );
  }

  return value;
}

export function parseBuildingFilter(
  raw: string | undefined,
  field = "building"
): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();

  if (!trimmed || trimmed.length > MAX_BUILDING_LEN || !SAFE_BUILDING_RE.test(trimmed)) {
    throw badRequest(
      `Invalid ${field}: must be 1-${MAX_BUILDING_LEN} safe building name characters`,
      { field, received: sanitizeReceived(raw) },
      "INVALID_QUERY"
    );
  }
  return trimmed;
}

export function parseRoomId(
  raw: string | undefined,
  field = "roomId"
): { building: string; room: string } {
  if (raw === undefined || raw.trim() === "" || raw.length > MAX_ROOM_ID_LEN) {
    throw badRequest(`Invalid ${field}`, { field }, "BAD_REQUEST");
  }
  const parts = partsFromRoomId(raw);
  if (
    !parts ||
    CONTROL_CHAR_RE.test(parts.building) ||
    CONTROL_CHAR_RE.test(parts.room) ||
    roomIdFromParts(parts.building, parts.room) !== raw
  ) {
    throw badRequest(`Invalid ${field}: malformed room identifier`, { field }, "BAD_REQUEST");
  }
  return parts;
}

export function parseBooleanFlag(raw: string | undefined, field: string): boolean {
  if (raw === undefined) return false;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  throw badRequest(
    `Invalid ${field}: expected 1, 0, true, or false`,
    { field, received: sanitizeReceived(raw) },
    "INVALID_QUERY"
  );
}

export function parseSubjectsQuery(
  raw: string | undefined,
  maxSubjects = 25
): string[] | undefined {
  if (raw === undefined) return undefined;
  const parsed = parseSubjectCodes(raw, maxSubjects);
  if (!parsed.ok) {
    throw badRequest(
      `Invalid subjects: expected comma-separated 2-6 letter department codes (max ${maxSubjects})`,
      { field: "subjects", received: sanitizeReceived(raw) },
      "INVALID_QUERY"
    );
  }
  return parsed.subjects;
}

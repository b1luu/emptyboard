import { DEFAULT_DAY_END_MIN, DEFAULT_DAY_START_MIN } from "./time-util";

export function dailyWindowFromEnv(): { dayStartMin: number; dayEndMin: number } {
  const s = process.env.EMPTYBOARD_DAY_START_MIN;
  const e = process.env.EMPTYBOARD_DAY_END_MIN;
  if (s !== undefined && e !== undefined) {
    const a = parseInt(s, 10);
    const b = parseInt(e, 10);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return { dayStartMin: a, dayEndMin: b };
    }
  }
  return { dayStartMin: DEFAULT_DAY_START_MIN, dayEndMin: DEFAULT_DAY_END_MIN };
}

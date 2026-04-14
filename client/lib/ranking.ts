import type { RoomApiItem, RoomRecommendation, SearchIntent } from "../types";

const areaBuildingHints: Record<NonNullable<SearchIntent["areaHint"]>, string[]> = {
  geisel: ["GEISEL", "CENTR", "RWAC"],
  cse: ["CSE", "EBU", "APM", "PCYNH"],
  near_me: [],
};

export function parseSmartSearch(raw: string): SearchIntent {
  const q = raw.trim().toLowerCase();
  const intent: SearchIntent = { raw, now: /now/.test(q) || q.length === 0 };

  const mMin = q.match(/(\d+)\s*min/);
  const mHour = q.match(/(\d+)\s*hour/);
  if (mMin) intent.durationMin = parseInt(mMin[1], 10);
  else if (mHour) intent.durationMin = parseInt(mHour[1], 10) * 60;

  if (q.includes("geisel")) intent.areaHint = "geisel";
  else if (q.includes("cse")) intent.areaHint = "cse";
  else if (q.includes("near me")) intent.areaHint = "near_me";

  return intent;
}

function proximityBoost(building: string, areaHint?: SearchIntent["areaHint"]): number {
  if (!areaHint || areaHint === "near_me") return 0;
  const b = building.toUpperCase();
  return areaBuildingHints[areaHint].some((hint) => b.includes(hint)) ? 80 : 0;
}

export function toRecommendations(
  rooms: RoomApiItem[],
  opts: { areaHint?: SearchIntent["areaHint"]; minDuration?: number }
): RoomRecommendation[] {
  const minDuration = opts.minDuration ?? 0;
  const recs = rooms
    .filter((r) => r.freeWindow)
    .map((r) => {
      const start = r.freeWindow?.startMin ?? 0;
      const end = r.freeWindow?.endMin ?? 0;
      const freeDurationMin = Math.max(0, end - start);
      return { r, freeDurationMin };
    })
    .filter((x) => x.freeDurationMin >= minDuration)
    .map(({ r, freeDurationMin }) => {
      const start = r.freeWindow?.startMin ?? 0;
      const end = r.freeWindow?.endMin ?? 0;
      const nowBoost = r.status === "open_now" ? 1000 : r.status === "opens_later" ? 500 : 200;
      const longBoost = freeDurationMin;
      const closeBoost = proximityBoost(r.building, opts.areaHint);
      const rankScore = nowBoost + longBoost + closeBoost;
      const statusLabel =
        r.status === "open_now" ? "Free now" : r.status === "opens_later" ? "Free soon" : "Occupied";
      const descriptor =
        freeDurationMin >= 120
          ? "Best for a long study block"
          : freeDurationMin >= 30
            ? "Best for a quick session"
            : "Short opening";
      const nearbyLabel =
        opts.areaHint === "geisel"
          ? "4 min from Geisel"
          : opts.areaHint === "cse"
            ? "3 min from CSE"
            : "Near central campus";

      const rec: RoomRecommendation = {
        building: r.building,
        room: r.room,
        roomId: r.roomId,
        freeStartMin: start,
        freeEndMin: end,
        freeStartLabel: r.freeWindow?.startLabel ?? "--",
        freeEndLabel: r.freeWindow?.endLabel ?? "--",
        freeDurationMin,
        statusLabel,
        descriptor,
        nearbyLabel,
        nextClassLabel: r.nextClass ? `${r.nextClass.label} at ${r.nextClass.startsAtLabel}` : "No next class listed",
        buildingMeta: `${r.building} · UCSD`,
        rankScore,
        isBest: false,
      };
      return rec;
    })
    .sort((a, b) => b.rankScore - a.rankScore || b.freeDurationMin - a.freeDurationMin || a.building.localeCompare(b.building));

  if (recs.length > 0) recs[0].isBest = true;
  return recs;
}

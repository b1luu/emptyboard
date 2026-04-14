import type { RoomRecommendation } from "../types";

type BuildingSummary = { building: string; freeCount: number; bestWindowMin: number };

type Props = {
  rooms: RoomRecommendation[];
  selectedBuilding: string;
  onSelectBuilding: (building: string) => void;
};

function groupByBuilding(rooms: RoomRecommendation[]): BuildingSummary[] {
  const m = new Map<string, BuildingSummary>();
  for (const r of rooms) {
    const cur = m.get(r.building) ?? { building: r.building, freeCount: 0, bestWindowMin: 0 };
    cur.freeCount += 1;
    cur.bestWindowMin = Math.max(cur.bestWindowMin, r.freeDurationMin);
    m.set(r.building, cur);
  }
  return [...m.values()].sort((a, b) => b.freeCount - a.freeCount || a.building.localeCompare(b.building));
}

function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function BuildingPanel({ rooms, selectedBuilding, onSelectBuilding }: Props) {
  const buildings = groupByBuilding(rooms);
  const selected = buildings.find((b) => b.building === selectedBuilding);
  return (
    <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-soft">
      <h3 className="text-sm font-semibold text-slate-100">Building view</h3>
      <p className="mt-1 text-xs text-slate-400">Tap a building to focus recommendations.</p>
      <div className="mt-3 grid gap-2">
        <button
          onClick={() => onSelectBuilding("")}
          className={`rounded-xl border px-3 py-2 text-left text-sm ${
            selectedBuilding ? "border-slate-700 text-slate-300" : "border-cyan-400 bg-cyan-500/10 text-cyan-200"
          }`}
        >
          All buildings
        </button>
        {buildings.map((b) => (
          <button
            key={b.building}
            onClick={() => onSelectBuilding(b.building)}
            className={`rounded-xl border px-3 py-2 text-left text-sm ${
              selectedBuilding === b.building
                ? "border-cyan-400 bg-cyan-500/10 text-cyan-200"
                : "border-slate-700 text-slate-300 hover:border-slate-600"
            }`}
          >
            <div className="font-medium">{b.building}</div>
            <div className="text-xs text-slate-400">{b.freeCount} rooms free now</div>
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">
        {selected ? (
          <>
            <div>{selected.freeCount} rooms free now</div>
            <div>best free window {durationLabel(selected.bestWindowMin)}</div>
          </>
        ) : (
          <div>Select a building for a quick summary.</div>
        )}
      </div>
    </aside>
  );
}

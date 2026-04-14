import type { RoomRecommendation } from "../types";
import { BUILDING_LOCATIONS } from "../data/buildingLocations";
import { useMemo, useRef, useState } from "react";

type Props = {
  rooms: RoomRecommendation[];
  selectedBuilding: string;
  onSelectBuilding: (building: string) => void;
  onFocusRoom: (roomId: string | null) => void;
};

type BuildingPoint = {
  building: string;
  x: number; // px in map canvas space
  y: number; // px in map canvas space
  freeCount: number;
  bestWindowMin: number;
  topRoomId: string | null;
};

const VIEW_W = 1000;
const VIEW_H = 420;
const TILE_LEFT = -6;
const TILE_RIGHT = 5;
const TILE_TOP = 5;
const ZOOM = 17;
const TILE_SIZE = 256;
const MAP_ZOOM = 1.5;
const SCALE = 2 ** (7 + ZOOM) * MAP_ZOOM;
const PADDING = { top: 60, horizontal: 50, bottom: 168 };
const REFERENCE_CENTER: [number, number] = [32.877341347399, -117.23531663418];
const MAP_TILE_SIZE = TILE_SIZE * MAP_ZOOM;

function latLongToPixel(lat: number, lng: number) {
  return {
    x: SCALE * (lng / 180 + 1),
    y: -SCALE * (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI + 1),
  };
}

type Geo = {
  southwest: { x: number; y: number };
  northeast: { x: number; y: number };
  mapPosition: { x: number; y: number; width: number };
  canvasWidth: number;
  canvasHeight: number;
};

function buildGeo(): Geo {
  const all = Object.values(BUILDING_LOCATIONS).map((loc) => latLongToPixel(loc.lat, loc.lng));
  const southwest = {
    x: Math.min(...all.map((p) => p.x)),
    y: Math.max(...all.map((p) => p.y)),
  };
  const northeast = {
    x: Math.max(...all.map((p) => p.x)),
    y: Math.min(...all.map((p) => p.y)),
  };
  const center = latLongToPixel(REFERENCE_CENTER[0], REFERENCE_CENTER[1]);
  const mapPosition = {
    x:
      Math.floor(center.x / MAP_TILE_SIZE + TILE_LEFT) * MAP_TILE_SIZE -
      (southwest.x - PADDING.horizontal),
    y:
      Math.floor(center.y / MAP_TILE_SIZE - TILE_TOP) * MAP_TILE_SIZE -
      (northeast.y - PADDING.top),
    width: (TILE_RIGHT - TILE_LEFT + 1) * MAP_TILE_SIZE,
  };
  const canvasWidth = northeast.x - southwest.x + PADDING.horizontal * 2;
  const canvasHeight = southwest.y - northeast.y + PADDING.top + PADDING.bottom;
  return { southwest, northeast, mapPosition, canvasWidth, canvasHeight };
}

function aggregate(rooms: RoomRecommendation[], geo: Geo): BuildingPoint[] {
  const map = new Map<string, { freeCount: number; bestWindowMin: number; topRoomId: string | null }>();
  for (const r of rooms) {
    const cur = map.get(r.building) ?? { freeCount: 0, bestWindowMin: 0, topRoomId: null };
    cur.freeCount += 1;
    cur.bestWindowMin = Math.max(cur.bestWindowMin, r.freeDurationMin);
    if (!cur.topRoomId) cur.topRoomId = r.roomId;
    map.set(r.building, cur);
  }
  const candidates = [...map.entries()].map(([building, v]) => ({ building, ...v }));
  const geocoded = candidates.filter((c) => BUILDING_LOCATIONS[c.building]);
  if (!geocoded.length) return [];

  return geocoded
    .map((c) => {
      const loc = BUILDING_LOCATIONS[c.building];
      const p = latLongToPixel(loc.lat, loc.lng);
      return {
        building: c.building,
        freeCount: c.freeCount,
        bestWindowMin: c.bestWindowMin,
        topRoomId: c.topRoomId,
        x: p.x - geo.southwest.x + PADDING.horizontal,
        y: p.y - geo.northeast.y + PADDING.top,
      };
    })
    .sort((a, b) => b.freeCount - a.freeCount || a.building.localeCompare(b.building));
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

type MarkerCluster = {
  key: string;
  x: number;
  y: number;
  buildings: BuildingPoint[];
};

function clusterMarkers(points: BuildingPoint[], zoom: number): MarkerCluster[] {
  const cell = Math.max(38, 78 / zoom);
  const buckets = new Map<string, BuildingPoint[]>();
  for (const p of points) {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    const k = `${cx}:${cy}`;
    const arr = buckets.get(k) ?? [];
    arr.push(p);
    buckets.set(k, arr);
  }
  return [...buckets.entries()].map(([key, arr]) => ({
    key,
    x: arr.reduce((s, a) => s + a.x, 0) / arr.length,
    y: arr.reduce((s, a) => s + a.y, 0) / arr.length,
    buildings: arr.sort((a, b) => b.freeCount - a.freeCount),
  }));
}

export function CampusMapPanel({ rooms, selectedBuilding, onSelectBuilding, onFocusRoom }: Props) {
  const geo = useMemo(() => buildGeo(), []);
  const buildings = useMemo(() => aggregate(rooms, geo), [rooms, geo]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const clusters = useMemo(() => clusterMarkers(buildings, zoom), [buildings, zoom]);
  const selected = buildings.find((b) => b.building === selectedBuilding) ?? null;

  const onWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.min(2.8, Math.max(0.85, z + delta)));
  };

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  };

  const stopDrag = () => {
    setDragging(false);
    dragStart.current = null;
  };

  const selectBuilding = (building: BuildingPoint) => {
    const active = building.building === selectedBuilding;
    onSelectBuilding(active ? "" : building.building);
    onFocusRoom(active ? null : building.topRoomId);
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-soft">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">Campus map (beta)</h3>
        <button
          onClick={() => onSelectBuilding("")}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
        >
          Clear
        </button>
      </div>

      <div
        className="relative h-[420px] overflow-hidden rounded-xl border border-slate-700"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={stopDrag}
        onMouseUp={stopDrag}
      >
        <div
          className="absolute inset-0 transition-transform duration-150"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" }}
        >
          <div className="relative" style={{ width: `${geo.canvasWidth}px`, height: `${geo.canvasHeight}px` }}>
            <img
              src="/maps/ucsd-map.webp"
              alt="UCSD map"
              draggable={false}
              className="pointer-events-none absolute select-none"
              style={{
                width: `${geo.mapPosition.width}px`,
                left: `${geo.mapPosition.x}px`,
                top: `${geo.mapPosition.y}px`,
              }}
            />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.11)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.11)_1px,transparent_1px)] bg-[size:28px_28px]" />
            <div className="pointer-events-none absolute inset-0 bg-slate-950/20" />
            {clusters.map((cluster) => {
              if (cluster.buildings.length === 1) {
                const b = cluster.buildings[0]!;
                const active = b.building === selectedBuilding;
                return (
                  <button
                    key={cluster.key}
                    onClick={() => selectBuilding(b)}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-1 text-[11px] font-semibold transition ${
                      active
                        ? "z-20 border-cyan-300 bg-cyan-400 text-slate-950"
                        : "z-10 border-slate-600 bg-slate-950/90 text-slate-200 hover:border-cyan-400"
                    }`}
                    style={{ left: `${b.x}px`, top: `${b.y}px` }}
                    title={`${b.building}: ${b.freeCount} free`}
                  >
                    {b.building} · {b.freeCount}
                  </button>
                );
              }
              const count = cluster.buildings.reduce((s, b) => s + b.freeCount, 0);
              return (
                <button
                  key={cluster.key}
                  onClick={() => {
                    setZoom((z) => Math.min(2.8, z + 0.25));
                    setPan((p) => ({
                      x: p.x + (VIEW_W / 2 - cluster.x) * 0.2,
                      y: p.y + (VIEW_H / 2 - cluster.y) * 0.2,
                    }));
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300 bg-amber-200 px-2 py-1 text-[11px] font-semibold text-slate-900"
                  style={{ left: `${cluster.x}px`, top: `${cluster.y}px` }}
                  title={`${cluster.buildings.length} nearby buildings, ${count} rooms`}
                >
                  {cluster.buildings.length} bldgs · {count}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
        {selected ? (
          <>
            <div className="font-semibold text-slate-100">{selected.building}</div>
            <div>{selected.freeCount} rooms free now</div>
            <div>Best free window {fmtDuration(selected.bestWindowMin)}</div>
          </>
        ) : (
          <div>Select a building marker to focus recommendations.</div>
        )}
      </div>
    </section>
  );
}

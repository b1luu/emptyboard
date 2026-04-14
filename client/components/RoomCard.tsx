import type { RoomRecommendation } from "../types";
import { TimelineStrip } from "./TimelineStrip";

type Props = {
  room: RoomRecommendation;
};

export function RoomCard({ room }: Props) {
  return (
    <article
      className={`rounded-2xl border p-4 shadow-soft ${
        room.isBest ? "border-cyan-400/80 bg-cyan-950/30" : "border-slate-800 bg-slate-900/70"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-xl font-semibold text-white">
            {room.building} {room.room}
          </div>
          <p className="text-sm text-slate-300">
            {room.statusLabel} until {room.freeEndLabel}
          </p>
        </div>
        {room.isBest ? (
          <span className="rounded-full bg-cyan-400/20 px-2 py-1 text-xs font-semibold text-cyan-200">Best option right now</span>
        ) : null}
      </div>
      <div className="space-y-2 text-sm text-slate-300">
        <p>{room.nearbyLabel}</p>
        <p>{room.descriptor}</p>
        <p className="text-slate-400">{room.nextClassLabel}</p>
      </div>
      <div className="mt-3">
        <TimelineStrip startMin={room.freeStartMin} endMin={room.freeEndMin} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span>{room.buildingMeta}</span>
        <span>
          {room.freeStartLabel} - {room.freeEndLabel}
        </span>
      </div>
    </article>
  );
}

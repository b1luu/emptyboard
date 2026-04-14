import type { RoomRecommendation } from "../types";
import { TimelineStrip } from "./TimelineStrip";

type Props = {
  room: RoomRecommendation;
  index?: number;
  highlighted?: boolean;
};

export function RoomCard({ room, index = 0, highlighted = false }: Props) {
  return (
    <article
      id={`room-card-${room.roomId}`}
      className={`animate-fade-in-up rounded-2xl border p-4 shadow-soft transition ${
        highlighted
          ? "border-cyan-500 bg-cyan-50 ring-2 ring-cyan-200"
          : room.isBest
            ? "border-cyan-400/60 bg-cyan-50"
            : "border-slate-200 bg-white"
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-xl font-semibold text-slate-900">
            {room.building} {room.room}
          </div>
          <p className="text-sm text-slate-500">
            {room.statusLabel} until {room.freeEndLabel}
          </p>
        </div>
        {room.isBest ? (
          <span className="rounded-full bg-cyan-100 px-2 py-1 text-xs font-semibold text-cyan-700">
            Best option right now
          </span>
        ) : null}
      </div>
      <div className="space-y-2 text-sm text-slate-500">
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

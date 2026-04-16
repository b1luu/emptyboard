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
      className={`animate-fade-in-up rounded-[1.5rem] border p-5 transition ${
        highlighted
          ? "border-black bg-[#fff8df] shadow-[6px_6px_0_0_rgba(0,0,0,0.9)]"
          : room.isBest
            ? "border-black bg-[#f4efe4] shadow-[6px_6px_0_0_rgba(0,0,0,0.9)]"
            : "border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,0.82)]"
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-xl font-semibold text-slate-900">
            {room.building} {room.room}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {room.statusLabel} until {room.freeEndLabel}
          </p>
        </div>
        {room.isBest ? (
          <span className="rounded-full border border-black bg-black px-2.5 py-1 text-xs font-semibold text-white">
            Best option right now
          </span>
        ) : null}
      </div>
      <div className="space-y-2 text-sm text-slate-600">
        <p>{room.nearbyLabel}</p>
        <p>{room.descriptor}</p>
        <p className="text-slate-500">{room.nextClassLabel}</p>
      </div>
      <div className="mt-3">
        <TimelineStrip startMin={room.freeStartMin} endMin={room.freeEndMin} />
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-3 text-xs font-medium text-slate-500">
        <span>{room.buildingMeta}</span>
        <span>
          {room.freeStartLabel} - {room.freeEndLabel}
        </span>
      </div>
    </article>
  );
}

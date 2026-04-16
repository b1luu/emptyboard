type Props = {
  startMin: number;
  endMin: number;
  dayStart?: number;
  dayEnd?: number;
};

export function TimelineStrip({ startMin, endMin, dayStart = 8 * 60, dayEnd = 22 * 60 }: Props) {
  const total = Math.max(1, dayEnd - dayStart);
  const left = Math.max(0, ((startMin - dayStart) / total) * 100);
  const width = Math.max(2, ((endMin - startMin) / total) * 100);
  return (
    <div className="relative h-2.5 w-full rounded-full border border-black/10 bg-[#ece7dc]">
      <div className="absolute inset-y-0 left-0 rounded-full bg-transparent" style={{ width: `${left}%` }} />
      <div className="absolute inset-y-0 rounded-full bg-black" style={{ left: `${left}%`, width: `${width}%` }} />
    </div>
  );
}

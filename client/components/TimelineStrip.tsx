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
    <div className="relative h-2 w-full rounded-full bg-slate-200">
      <div className="absolute inset-y-0 left-0 rounded-full bg-slate-100" style={{ width: `${left}%` }} />
      <div className="absolute inset-y-0 rounded-full bg-cyan-400" style={{ left: `${left}%`, width: `${width}%` }} />
    </div>
  );
}

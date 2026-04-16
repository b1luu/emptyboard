type Props = {
  open: boolean;
  day: string;
  start: string;
  end: string;
  minFreeMin: number;
  building: string;
  whiteboard: boolean;
  onChange: (patch: Partial<{ day: string; start: string; end: string; minFreeMin: number; building: string; whiteboard: boolean }>) => void;
  embedded?: boolean;
};

export function AdvancedFilters({ open, day, start, end, minFreeMin, building, whiteboard, onChange, embedded = false }: Props) {
  if (!open) return null;
  return (
    <section
      className={
        embedded
          ? "mt-4 w-full rounded-[1.25rem] border border-black bg-[#fbfbfb] p-4"
          : "mx-auto mt-4 w-full max-w-7xl rounded-[1.5rem] border border-black bg-white p-4 shadow-[6px_6px_0_0_rgba(0,0,0,0.85)]"
      }
    >
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50">Advanced</p>
        <p className="mt-1 text-sm text-black/65">Low-level knobs for the search request.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-6">
        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
          Day
          <input
            value={day}
            onChange={(e) => onChange({ day: e.target.value })}
            className="w-full rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3 text-sm text-slate-800"
          />
        </label>
        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
          Start
          <input
            value={start}
            onChange={(e) => onChange({ start: e.target.value })}
            className="w-full rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3 text-sm text-slate-800"
          />
        </label>
        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
          End
          <input
            value={end}
            onChange={(e) => onChange({ end: e.target.value })}
            className="w-full rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3 text-sm text-slate-800"
          />
        </label>
        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
          Min free
          <input
            type="number"
            value={minFreeMin}
            onChange={(e) => onChange({ minFreeMin: Number(e.target.value) || 0 })}
            className="w-full rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3 text-sm text-slate-800"
          />
        </label>
        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
          Building
          <input
            value={building}
            onChange={(e) => onChange({ building: e.target.value })}
            className="w-full rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3 text-sm text-slate-800"
          />
        </label>
        <label className="flex min-h-full items-center gap-3 rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3 text-sm text-slate-700">
          <input type="checkbox" checked={whiteboard} onChange={(e) => onChange({ whiteboard: e.target.checked })} />
          Whiteboard placeholder
        </label>
      </div>
    </section>
  );
}

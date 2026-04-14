type Props = {
  open: boolean;
  day: string;
  start: string;
  end: string;
  minFreeMin: number;
  building: string;
  whiteboard: boolean;
  onChange: (patch: Partial<{ day: string; start: string; end: string; minFreeMin: number; building: string; whiteboard: boolean }>) => void;
};

export function AdvancedFilters({ open, day, start, end, minFreeMin, building, whiteboard, onChange }: Props) {
  if (!open) return null;
  return (
    <section className="mx-auto mt-3 w-full max-w-7xl rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
      <div className="grid gap-3 md:grid-cols-6">
        <label className="space-y-1 text-xs text-slate-500">
          Day
          <input
            value={day}
            onChange={(e) => onChange({ day: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="space-y-1 text-xs text-slate-500">
          Start
          <input
            value={start}
            onChange={(e) => onChange({ start: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="space-y-1 text-xs text-slate-500">
          End
          <input
            value={end}
            onChange={(e) => onChange({ end: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="space-y-1 text-xs text-slate-500">
          Min free
          <input
            type="number"
            value={minFreeMin}
            onChange={(e) => onChange({ minFreeMin: Number(e.target.value) || 0 })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="space-y-1 text-xs text-slate-500">
          Building
          <input
            value={building}
            onChange={(e) => onChange({ building: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="flex items-end gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={whiteboard} onChange={(e) => onChange({ whiteboard: e.target.checked })} />
          Whiteboard placeholder
        </label>
      </div>
    </section>
  );
}

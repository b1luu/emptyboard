import type { Term } from "../types";

type Props = {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  term: string;
  terms: Term[];
  onTermChange: (v: string) => void;
  selectedDate: string;
  selectedTime: string;
  durationMin: number;
  onDateChange: (v: string) => void;
  onTimeChange: (v: string) => void;
  onDurationChange: (v: number) => void;
};

export function SearchBar({
  query,
  onQueryChange,
  onSubmit,
  term,
  terms,
  onTermChange,
  selectedDate,
  selectedTime,
  durationMin,
  onDateChange,
  onTimeChange,
  onDurationChange,
}: Props) {
  return (
    <div className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 py-3 md:px-6">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">EmptyBoard</h1>
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2 shadow-soft">
          <input
            className="w-full bg-transparent px-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            placeholder="Find a room now, near Geisel, for 90 minutes"
          />
          <button
            onClick={onSubmit}
            className="rounded-lg bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-600"
          >
            Search
          </button>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
          aria-label="Selected date"
        />
        <input
          type="time"
          value={selectedTime}
          onChange={(e) => onTimeChange(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
          aria-label="Selected time"
        />
        <select
          value={durationMin}
          onChange={(e) => onDurationChange(parseInt(e.target.value, 10))}
          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
          aria-label="Duration"
        >
          <option value={30}>30 min</option>
          <option value={60}>1 hour</option>
          <option value={120}>2 hours</option>
        </select>
        <select
          value={term}
          onChange={(e) => onTermChange(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
        >
          {terms.map((t) => (
            <option key={t.code} value={t.code}>
              {t.code}
            </option>
          ))}
        </select>
        <button className="rounded-lg border border-slate-200 px-2 py-2 text-xs text-slate-600 hover:bg-slate-50">
          Help
        </button>
      </div>
    </div>
  );
}

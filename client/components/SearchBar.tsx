import type { Term } from "../types";

type Props = {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  onBackToLanding: () => void;
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
  onBackToLanding,
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
    <div className="sticky top-0 z-30 border-b border-black/10 bg-[#f4f4f4]/95 backdrop-blur">
      <div className="mx-auto w-full max-w-7xl px-4 py-4 md:px-6">
        <section className="rounded-[2rem] border border-black bg-white p-4 text-black shadow-[8px_8px_0_0_rgba(0,0,0,0.9)] md:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-black/55">
                  EmptyBoard
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
                  Choose the time window first.
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-black/65">
                  Keep this step focused: set when you need a room, then move forward.
                </p>
              </div>
              <button
                onClick={onBackToLanding}
                className="rounded-2xl border border-black bg-white px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-black/5"
              >
                Back to landing
              </button>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,0.55fr))]">
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
                Search
                <div className="flex items-center gap-2 rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3">
                  <input
                    className="w-full bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onSubmit()}
                    placeholder="Find a room now, near Geisel, for 90 minutes"
                  />
                  <button
                    onClick={onSubmit}
                    className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white transition hover:bg-black/90"
                  >
                    Search
                  </button>
                </div>
              </label>

              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
                Date
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => onDateChange(e.target.value)}
                  className="w-full rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3 text-sm text-slate-700"
                  aria-label="Selected date"
                />
              </label>

              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
                Time
                <input
                  type="time"
                  value={selectedTime}
                  onChange={(e) => onTimeChange(e.target.value)}
                  className="w-full rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3 text-sm text-slate-700"
                  aria-label="Selected time"
                />
              </label>

              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
                Duration
                <select
                  value={durationMin}
                  onChange={(e) => onDurationChange(parseInt(e.target.value, 10))}
                  className="w-full rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3 text-sm text-slate-700"
                  aria-label="Duration"
                >
                  <option value={30}>30 min</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                </select>
              </label>

              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-black/50">
                Term
                <select
                  value={term}
                  onChange={(e) => onTermChange(e.target.value)}
                  className="w-full rounded-2xl border border-black bg-[#fbfbfb] px-3 py-3 text-sm text-slate-700"
                >
                  {terms.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

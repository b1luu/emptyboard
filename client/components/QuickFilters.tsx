import type { QuickChipId } from "../types";

const chips: { id: QuickChipId; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "next30", label: "Next 30 min" },
  { id: "oneToTwo", label: "1-2 hours" },
  { id: "nearMe", label: "Near me" },
  { id: "nearGeisel", label: "Near Geisel" },
  { id: "nearCse", label: "Near CSE" },
];

type Props = {
  active: Set<QuickChipId>;
  onToggle: (id: QuickChipId) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
};

export function QuickFilters({ active, onToggle, showAdvanced, onToggleAdvanced }: Props) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-3 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            onClick={() => onToggle(chip.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              active.has(chip.id)
                ? "border-cyan-400 bg-cyan-500/15 text-cyan-200"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
            }`}
          >
            {chip.label}
          </button>
        ))}
        <button
          onClick={onToggleAdvanced}
          className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600"
        >
          {showAdvanced ? "Hide advanced" : "Advanced filters"}
        </button>
      </div>
    </div>
  );
}

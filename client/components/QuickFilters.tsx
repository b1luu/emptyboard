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
  embedded?: boolean;
};

export function QuickFilters({ active, onToggle, showAdvanced, onToggleAdvanced, embedded = false }: Props) {
  return (
    <div className={embedded ? "w-full" : "mx-auto w-full max-w-7xl px-4 pt-4 md:px-6"}>
      <div className={embedded ? "rounded-[1.25rem] border border-black bg-[#fbfbfb] p-4" : "rounded-[1.5rem] border border-black bg-white p-4 shadow-[6px_6px_0_0_rgba(0,0,0,0.85)]"}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/50">Quick picks</p>
            <p className="mt-1 text-sm text-black/65">Fast constraints for the results below.</p>
          </div>
          <button
            onClick={onToggleAdvanced}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
              showAdvanced
                ? "border-black bg-black text-white"
                : "border-black bg-white text-black hover:-translate-y-0.5 hover:bg-black/5"
            }`}
          >
            {showAdvanced ? "Hide advanced" : "Advanced filters"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            onClick={() => onToggle(chip.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
              active.has(chip.id)
                ? "border-black bg-black text-white shadow-sm"
                : "border-black/20 bg-[#f8f8f8] text-black/70 hover:-translate-y-0.5 hover:border-black hover:bg-white"
            }`}
          >
            {chip.label}
          </button>
        ))}
        </div>
      </div>
    </div>
  );
}

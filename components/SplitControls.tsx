import { Check, Download, Loader2, Minus, Plus, Scissors } from "lucide-react";

export type SectionMeta = { start: number; end: number; length: number };

type SplitControlsProps = {
  hasFile: boolean;
  totalPages: number;
  manualCuts: number;
  autoSplitEnabled: boolean;
  autoSplitInterval: number;
  onAutoSplitEnabledChange: (enabled: boolean) => void;
  onAutoSplitIntervalChange: (value: number) => void;
  sections: SectionMeta[];
  skipped: Set<number>;
  onToggleSkip: (index: number) => void;
  onClearCuts: () => void;
  onDownloadSection: (index: number) => void;
  busySection: number | null;
};

export function SplitControls({
  hasFile,
  totalPages,
  manualCuts,
  autoSplitEnabled,
  autoSplitInterval,
  onAutoSplitEnabledChange,
  onAutoSplitIntervalChange,
  sections,
  skipped,
  onToggleSkip,
  onClearCuts,
  onDownloadSection,
  busySection,
}: SplitControlsProps) {
  const included = sections.filter((_, idx) => !skipped.has(idx)).length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900">Split every N pages</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Overrides the manual cut marks
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoSplitEnabled}
            onClick={() => onAutoSplitEnabledChange(!autoSplitEnabled)}
            className={`relative h-7 w-12 flex-shrink-0 rounded-full transition ${
              autoSplitEnabled ? "bg-zinc-900" : "bg-zinc-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                autoSplitEnabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>

        <div
          className={`mt-3 flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-1.5 transition ${
            autoSplitEnabled ? "" : "pointer-events-none opacity-45"
          }`}
        >
          <button
            type="button"
            onClick={() => onAutoSplitIntervalChange(Math.max(1, autoSplitInterval - 1))}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 transition active:scale-95"
            aria-label="Fewer pages per file"
          >
            <Minus className="h-4 w-4" />
          </button>
          <div className="text-center">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={Math.max(1, totalPages)}
              value={autoSplitInterval}
              onChange={(event) =>
                onAutoSplitIntervalChange(Math.max(1, Number(event.target.value) || 1))
              }
              className="w-16 rounded-lg border border-zinc-200 bg-white py-1.5 text-center text-base font-semibold text-zinc-900 focus:border-zinc-400 focus:outline-none"
            />
            <p className="mt-0.5 text-[11px] text-zinc-500">pages / file</p>
          </div>
          <button
            type="button"
            onClick={() => onAutoSplitIntervalChange(autoSplitInterval + 1)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 transition active:scale-95"
            aria-label="More pages per file"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm text-zinc-700">
          <Scissors className="h-4 w-4 text-zinc-400" />
          <span>
            {autoSplitEnabled
              ? "Manual cuts paused"
              : `${manualCuts} manual cut${manualCuts === 1 ? "" : "s"}`}
          </span>
        </div>
        <button
          type="button"
          onClick={onClearCuts}
          disabled={autoSplitEnabled || manualCuts === 0}
          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition active:bg-zinc-100 disabled:opacity-40"
        >
          Clear all
        </button>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Files to create
          </p>
          <span className="text-xs text-zinc-500">
            {included} of {sections.length}
          </span>
        </div>
        <div className="space-y-2">
          {sections.map((meta, idx) => {
            const isSkipped = skipped.has(idx);
            return (
              <div
                key={`section-${idx}`}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition ${
                  isSkipped
                    ? "border-zinc-200 bg-zinc-50"
                    : "border-zinc-200 bg-white"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onToggleSkip(idx)}
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border transition active:scale-95 ${
                    isSkipped
                      ? "border-zinc-300 bg-white text-transparent"
                      : "border-zinc-900 bg-zinc-900 text-white"
                  }`}
                  aria-label={
                    isSkipped ? `Include file ${idx + 1}` : `Exclude file ${idx + 1}`
                  }
                >
                  <Check className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-semibold ${
                      isSkipped ? "text-zinc-400 line-through" : "text-zinc-900"
                    }`}
                  >
                    Part {idx + 1}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {meta.length === 1
                      ? `Page ${meta.start + 1}`
                      : `Pages ${meta.start + 1}–${meta.end + 1}`}{" "}
                    · {meta.length} page{meta.length === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDownloadSection(idx)}
                  disabled={!hasFile || isSkipped || busySection !== null}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 transition active:scale-95 disabled:opacity-40"
                  aria-label={`Download part ${idx + 1}`}
                >
                  {busySection === idx ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </button>
              </div>
            );
          })}
          {sections.length === 0 && (
            <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-6 text-center text-xs text-zinc-500">
              Add a PDF to see the files you will get.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

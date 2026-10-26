import { Download, Loader2 } from "lucide-react";
import type { SizeMode } from "../lib/types";
import type { CoverChoice } from "../lib/types";

interface Props {
  choice: CoverChoice | null;
  mode: SizeMode;
  onMode: (m: SizeMode) => void;
  busy: boolean;
  onDownload: () => void;
}

const MODES: Array<[SizeMode, string, string]> = [
  ["asis", "As is", "keep the picture exactly"],
  ["fit", "Fit", "pad to book shape"],
  ["fill", "Fill", "crop to book shape"],
];

export default function ActionCard({
  choice,
  mode,
  onMode,
  busy,
  onDownload,
}: Props) {
  return (
    <section
      aria-label="Download"
      className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">Picture size</legend>
        {MODES.map(([id, label, hint]) => (
          <label
            key={id}
            title={hint}
            className={`cursor-pointer rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
              mode === id
                ? "border-brand bg-surface-2 text-ink"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name="size-mode"
              value={id}
              checked={mode === id}
              onChange={() => onMode(id)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-primary px-6 py-3 text-base"
          disabled={!choice || busy}
          onClick={onDownload}
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-5" aria-hidden="true" />
          )}
          {busy ? "Building your EPUB…" : "Download EPUB"}
        </button>
      </div>
      {!choice && (
        <p className="text-sm text-faint sm:hidden">
          Pick a cover first.
        </p>
      )}
    </section>
  );
}

import { BookX, RotateCcw } from "lucide-react";
import type { SizeMode } from "../lib/types";

interface Props {
  title: string;
  author: string;
  isbn: string | null;
  coverUrl: string | null;
  previewing: boolean;
  mode: SizeMode;
  fileName: string;
  fileSize: number;
  onReset: () => void;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BookCard({
  title,
  author,
  isbn,
  coverUrl,
  previewing,
  mode,
  fileName,
  fileSize,
  onReset,
}: Props) {
  return (
    <section aria-label="Book" className="card flex gap-5 p-5">
      <div className="w-28 shrink-0 sm:w-36">
        <p className="mb-1.5 text-xs font-semibold text-faint">
          {previewing ? "New cover" : coverUrl ? "Current cover" : "Cover"}
        </p>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`Current cover of ${title}`}
            className={`aspect-10/16 w-full rounded-lg border border-line shadow-soft ${
              previewing && mode !== "fill"
                ? "bg-white object-contain"
                : "object-cover"
            }`}
          />
        ) : (
          <div className="flex aspect-10/16 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line bg-surface-2 p-2 text-center">
            <BookX className="size-6 text-faint" aria-hidden="true" />
            <span className="text-xs text-muted">No cover yet</span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg leading-snug font-semibold text-balance text-ink">
          {title}
        </h2>
        {author && <p className="mt-0.5 text-sm text-muted">{author}</p>}
        <p className="mt-3 truncate text-xs text-faint" title={fileName}>
          {fileName} · {humanSize(fileSize)}
        </p>
        {isbn && (
          <p className="mt-0.5 text-xs text-faint">ISBN {isbn}</p>
        )}
        <button
          type="button"
          onClick={onReset}
          className="btn-quiet mt-4 px-3 py-1.5 text-xs"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Choose another file
        </button>
      </div>
    </section>
  );
}

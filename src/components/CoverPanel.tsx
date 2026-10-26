import { useEffect, useRef, useState } from "react";
import { ImagePlus, Search, SearchX, WifiOff } from "lucide-react";
import type { CoverResult } from "../lib/covers";

export type SearchStatus = "idle" | "loading" | "ready" | "error";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  status: SearchStatus;
  error: string | null;
  offline: boolean;
  items: CoverResult[];
  selectedUrl: string | null;
  onPickRemote: (item: CoverResult) => void;
  onPickFile: (file: File) => void;
  uploadedPreview: string | null;
  uploadedName: string | null;
}

export default function CoverPanel({
  query,
  onQueryChange,
  onSearch,
  status,
  error,
  offline,
  items,
  selectedUrl,
  onPickRemote,
  onPickFile,
  uploadedPreview,
  uploadedName,
}: Props) {
  const [tab, setTab] = useState<"search" | "upload">("search");
  const fileRef = useRef<HTMLInputElement>(null);
  // per-search image failure bookkeeping: retry each tile once at full
  // size, then drop it so no empty frames sit in the grid
  const [broken, setBroken] = useState<string[]>([]);
  const [useFull, setUseFull] = useState<Set<string>>(new Set());
  useEffect(() => {
    setBroken([]);
    setUseFull(new Set());
  }, [items]);

  return (
    <section aria-label="Pick a cover" className="card flex h-full min-h-0 flex-col p-5">
      <div
        role="tablist"
        aria-label="Cover source"
        className="mb-4 flex gap-1 rounded-xl bg-surface-2 p-1"
      >
        {(
          [
            ["search", "Find a cover"],
            ["upload", "Upload your own"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold transition-colors outline-none focus-visible:outline-2 focus-visible:outline-focus ${
              tab === id
                ? "bg-surface text-ink shadow-soft"
                : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "search" && (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSearch();
            }}
          >
            <label className="sr-only" htmlFor="cover-search">
              Search Open Library for covers
            </label>
            <input
              id="cover-search"
              className="input-base"
              value={query}
              placeholder="Book title and author"
              onChange={(e) => onQueryChange(e.target.value)}
            />
            <button
              type="submit"
              className="btn-quiet shrink-0"
              disabled={status === "loading"}
            >
              <Search className="size-4" aria-hidden="true" />
              Search
            </button>
          </form>

          <div
            aria-live="polite"
            className="mt-2 text-xs text-faint"
          >
            {status === "loading" && "Searching Open Library…"}
            {status === "ready" && items.length > 0 &&
              `${items.length} cover${items.length === 1 ? "" : "s"} from Open Library — tap one, then download`}
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {status === "loading" && (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <li
                    key={i}
                    aria-hidden="true"
                    className="aspect-10/16 animate-pulse rounded-lg bg-surface-2"
                  />
                ))}
              </ul>
            )}

            {status === "error" && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                {offline ? (
                  <WifiOff className="size-6 text-faint" aria-hidden="true" />
                ) : (
                  <SearchX className="size-6 text-faint" aria-hidden="true" />
                )}
                <p className="text-sm text-muted">{error}</p>
                <button type="button" onClick={onSearch} className="btn-quiet mt-1 px-3 py-1.5 text-xs">
                  Try again
                </button>
              </div>
            )}

            {status === "ready" && items.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <SearchX className="size-6 text-faint" aria-hidden="true" />
                <p className="text-sm text-muted">
                  Nothing found for “{query}”.
                </p>
                <p className="text-sm text-faint">
                  Try the title on its own, or upload a picture.
                </p>
              </div>
            )}

            {status === "ready" && items.length > 0 && (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {items
                  .filter((item) => !broken.includes(item.url))
                  .map((item) => {
                  const selected = item.url === selectedUrl;
                  return (
                    <li key={item.url}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={`Use this cover: ${item.alt}`}
                        onClick={() => onPickRemote(item)}
                        className={`block aspect-10/16 w-full cursor-pointer overflow-hidden rounded-lg border outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                          selected
                            ? "border-accent ring-2 ring-accent"
                            : "border-line hover:border-brand"
                        }`}
                      >
                        <img
                          src={useFull.has(item.url) ? item.url : item.thumbUrl}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                          onError={() => {
                            // the medium thumbnail can 500 while the full
                            // size is fine; if both fail, drop the tile
                            if (!useFull.has(item.url)) {
                              setUseFull((s) => new Set(s).add(item.url));
                            } else {
                              setBroken((b) => [...b, item.url]);
                            }
                          }}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {tab === "upload" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
          {uploadedPreview ? (
            <>
              <img
                src={uploadedPreview}
                alt={`Selected upload: ${uploadedName ?? "image"}`}
                className="max-h-64 rounded-lg border border-line object-contain shadow-soft"
              />
              <p className="text-sm text-muted">{uploadedName}</p>
            </>
          ) : (
            <p className="text-sm text-muted">
              JPG, PNG or WebP work best.
              <br />
              Tall pictures look best on covers.
            </p>
          )}
          <button
            type="button"
            className="btn-quiet"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {uploadedPreview ? "Pick a different picture" : "Choose a picture"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </section>
  );
}

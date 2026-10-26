import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Library, Moon, Smartphone, Sun } from "lucide-react";
import ActionCard from "./components/ActionCard";
import BookCard from "./components/BookCard";
import CoverPanel, { type SearchStatus } from "./components/CoverPanel";
import Dropzone from "./components/Dropzone";
import Toasts, { type Toast } from "./components/Toasts";
import {
  coverForIsbn,
  CoverSearchError,
  guessQuery,
  searchCovers,
  type CoverResult,
} from "./lib/covers";
import { EpubError, parseEpub, setCover, suggestFileName, type ParsedEpub } from "./lib/epub";
import { renderCover, urlForBytes, urlForFile } from "./lib/image";
import { saveBlob } from "./lib/save";
import type { CoverChoice, SizeMode } from "./lib/types";

interface BookState {
  parsed: ParsedEpub;
  fileName: string;
  fileSize: number;
  coverUrl: string | null; // object URL of the current cover, if any
}

const MODE_KEY = "coverly:mode";
const THEME_KEY = "coverly:theme";
const OK_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Where "as is" may fetch cover bytes: our own blob objects and the
 * Open Library image CDN only. Never an arbitrary URL a bug or a
 * tampered result list might introduce.
 */
function fetchable(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    if (u.protocol === "blob:") return true;
    return (
      u.protocol === "https:" &&
      (u.hostname === "covers.openlibrary.org" ||
        u.hostname === "openlibrary.org")
    );
  } catch {
    return false;
  }
}

function friendlyError(e: unknown): string {
  if (e instanceof EpubError) {
    if (e.kind === "drm")
      return "This book is DRM-protected, so its cover cannot be changed. DRM-free copies work fine.";
    if (e.kind === "not-zip")
      return "This file is not a readable EPUB. Is it actually an ebook?";
    if (e.kind === "not-epub")
      return "This zip is not an EPUB — it has no mimetype entry.";
    if (e.kind === "too-large") return e.message;
    if (e.kind === "no-opf")
      return "This EPUB looks broken: no package file inside.";
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export default function App() {
  const [dark, setDark] = useState(
    () => document.documentElement.classList.contains("dark"),
  );
  const [busy, setBusy] = useState<"parse" | "build" | null>(null);
  const [book, setBook] = useState<BookState | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [items, setItems] = useState<CoverResult[]>([]);
  const [choice, setChoice] = useState<CoverChoice | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [mode, setModeState] = useState<SizeMode>(
    () => (localStorage.getItem(MODE_KEY) as SizeMode) || "fit",
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const objectUrls = useRef<string[]>([]);

  const trackUrl = (url: string) => {
    objectUrls.current.push(url);
  };

  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      kind === "bad" ? 9000 : 5000,
    );
  }, []);

  const setMode = (m: SizeMode) => {
    setModeState(m);
    localStorage.setItem(MODE_KEY, m);
  };

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
  };

  const runSearch = useCallback(
    async (q: string, isbn: string | null) => {
      setStatus("loading");
      setSearchError(null);
      setOffline(false);
      let found: CoverResult[] = [];
      let error: string | null = null;
      let isOffline = false;
      const [isbnRes, searchRes] = await Promise.allSettled([
        isbn ? coverForIsbn(isbn) : Promise.resolve(null),
        q.trim() ? searchCovers(q) : Promise.resolve([]),
      ]);
      if (searchRes.status === "fulfilled") {
        found = searchRes.value;
      } else {
        error =
          searchRes.reason instanceof CoverSearchError
            ? searchRes.reason.message
            : "Search failed. Check your connection.";
        isOffline =
          searchRes.reason instanceof CoverSearchError &&
          searchRes.reason.offline;
      }
      const isbnCover =
        isbnRes.status === "fulfilled" && isbnRes.value ? isbnRes.value : null;
      const merged = isbnCover
        ? [isbnCover, ...found.filter((c) => c.url !== isbnCover.url)]
        : found;
      setItems(merged);
      if (merged.length === 0 && error) {
        setStatus("error");
        setSearchError(error);
        setOffline(isOffline);
      } else {
        setStatus("ready");
      }
    },
    [],
  );

  const onFile = useCallback(
    async (file: File) => {
      setBusy("parse");
      setBook(null);
      setChoice(null);
      setItems([]);
      try {
        const parsed = await parseEpub(file);
        const coverUrl = parsed.coverData
          ? (() => {
              const u = urlForBytes(parsed.coverData, parsed.coverMediaSubtype);
              trackUrl(u);
              return u;
            })()
          : null;
        setBook({
          parsed,
          fileName: file.name,
          fileSize: file.size,
          coverUrl,
        });
        const q = guessQuery(parsed.meta) ?? "";
        setQuery(q);
        if (q || parsed.meta.isbn) void runSearch(q, parsed.meta.isbn);
        else setStatus("idle");
      } catch (e) {
        toast(friendlyError(e), "bad");
      } finally {
        setBusy(null);
      }
    },
    [runSearch, toast],
  );

  const onPickRemote = useCallback((item: CoverResult) => {
    setChoice({ url: item.url, alt: item.alt });
  }, []);

  const onPickFile = useCallback(
    async (file: File) => {
      if (!OK_IMAGE_TYPES.has(file.type)) {
        toast("That is not a supported image (JPG, PNG or WebP).", "bad");
        return;
      }
      try {
        const url = await urlForFile(file);
        trackUrl(url);
        setChoice({ url, alt: file.name, original: file });
        setUploadedName(file.name);
      } catch (e) {
        toast(friendlyError(e), "bad");
      }
    },
    [toast],
  );

  const normalizeMime = (mime: string): string => {
    if (!mime.startsWith("image/")) return "image/jpeg";
    if (mime === "image/jpg" || mime === "image/pjpeg") return "image/jpeg";
    return mime;
  };

  const onDownload = useCallback(async () => {
    if (!book || !choice) return;
    setBusy("build");
    try {
      let blob: Blob;
      if (mode === "asis" && choice.original) {
        blob = choice.original;
      } else if (mode === "asis") {
        if (!fetchable(choice.url))
          throw new Error("Cover source not allowed.");
        const res = await fetch(choice.url);
        if (!res.ok) throw new Error("Could not download that cover image.");
        blob = await res.blob();
      } else {
        blob = (await renderCover(choice.url, mode)).blob;
      }
      const data = new Uint8Array(await blob.arrayBuffer());
      const mime = normalizeMime(blob.type || "image/jpeg");
      const out = await setCover(book.parsed, { data, mime });
      const name = suggestFileName(book.parsed, book.fileName);
      saveBlob(out, name);
      toast(`Saved as ${name}`, "ok");
    } catch (e) {
      toast(friendlyError(e), "bad");
    } finally {
      setBusy(null);
    }
  }, [book, choice, mode, toast]);

  const onReset = useCallback(() => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
    setBook(null);
    setChoice(null);
    setUploadedName(null);
    setItems([]);
    setQuery("");
    setStatus("idle");
  }, []);

  useEffect(() => {
    const onExit = () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
    };
    window.addEventListener("pagehide", onExit);
    return () => window.removeEventListener("pagehide", onExit);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-page/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-3xl leading-none font-bold text-brand">
              Coverly
            </span>
            <span className="hidden text-sm text-faint sm:inline">
              EPUB cover editor
            </span>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="btn-quiet size-9 rounded-full p-0"
          >
            {dark ? (
              <Sun className="size-4.5" aria-hidden="true" />
            ) : (
              <Moon className="size-4.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        {!book ? (
          <div className="mx-auto max-w-2xl">
            <h1 className="text-center text-3xl font-bold text-balance text-ink sm:text-4xl">
              Fix a book&apos;s cover in seconds
            </h1>
            <p className="mx-auto mt-3 max-w-md text-center text-muted">
              Drop in an EPUB, pick artwork, download it with a real cover.
              The book never leaves this browser.
            </p>
            <div className="mt-8">
              <Dropzone onFile={onFile} busy={busy === "parse"} />
            </div>
            <ul className="mt-10 grid gap-6 text-center sm:grid-cols-3">
              <li className="flex flex-col items-center gap-2">
                <Library className="size-5 text-brand" aria-hidden="true" />
                <span className="text-sm font-semibold text-ink">
                  Covers built in
                </span>
                <span className="text-sm text-muted">
                  Search Open Library, or upload any picture
                </span>
              </li>
              <li className="flex flex-col items-center gap-2">
                <Download className="size-5 text-brand" aria-hidden="true" />
                <span className="text-sm font-semibold text-ink">
                  Works everywhere
                </span>
                <span className="text-sm text-muted">
                  Output opens in Calibre, KOReader, Apple Books and phones
                </span>
              </li>
              <li className="flex flex-col items-center gap-2">
                <Smartphone className="size-5 text-brand" aria-hidden="true" />
                <span className="text-sm font-semibold text-ink">
                  Installs like an app
                </span>
                <span className="text-sm text-muted">
                  Add it to your phone or desktop from the browser menu
                </span>
              </li>
            </ul>
          </div>
        ) : (
          <>
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,21rem)minmax(0,1fr)]">
              <BookCard
                title={book.parsed.meta.title}
                author={book.parsed.meta.author}
                isbn={book.parsed.meta.isbn}
                coverUrl={choice?.url ?? book.coverUrl}
                previewing={!!choice}
                mode={mode}
                fileName={book.fileName}
                fileSize={book.fileSize}
                onReset={onReset}
              />
              <div className="lg:h-[34rem]">
                <CoverPanel
                  query={query}
                  onQueryChange={setQuery}
                  onSearch={() => void runSearch(query, book.parsed.meta.isbn)}
                  status={status}
                  error={searchError}
                  offline={offline}
                  items={items}
                  selectedUrl={choice?.url ?? null}
                  onPickRemote={onPickRemote}
                  onPickFile={(f) => void onPickFile(f)}
                  uploadedPreview={
                    choice?.original ? choice.url : null
                  }
                  uploadedName={uploadedName}
                />
              </div>
            </div>
            <div className="mt-5">
              <ActionCard
                choice={choice}
                mode={mode}
                onMode={setMode}
                busy={busy === "build"}
                onDownload={() => void onDownload()}
              />
            </div>
          </>
        )}
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap justify-center gap-x-6 gap-y-1 px-4 py-6 text-xs text-faint">
        <span>Book covers from Open Library</span>
        <span>Every step runs on your device</span>
      </footer>

      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))}
      />
    </div>
  );
}

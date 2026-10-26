import { useCallback, useRef, useState } from "react";
import { FileUp } from "lucide-react";

interface Props {
  onFile: (file: File) => void;
  busy?: boolean;
  compact?: boolean;
}

const EPUB_OK = /\.epub$/i;

export default function Dropzone({ onFile, busy, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = useCallback(
    (file: File | undefined) => {
      setError(null);
      if (!file) return;
      if (!EPUB_OK.test(file.name)) {
        setError("That is not an EPUB file.");
        return;
      }
      onFile(file);
    },
    [onFile],
  );

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        aria-label="Choose an EPUB file"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files?.[0]);
        }}
        className={`flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed text-center transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60 ${
          compact ? "px-6 py-8" : "px-6 py-16 sm:py-20"
        } ${
          over
            ? "border-accent bg-accent/5"
            : "border-line bg-surface hover:border-brand hover:bg-surface-2"
        }`}
      >
        <span
          className={`flex items-center justify-center rounded-full ${
            compact ? "size-10 bg-surface-2" : "size-14 bg-surface-2"
          }`}
        >
          <FileUp className={compact ? "size-5 text-brand" : "size-7 text-brand"} />
        </span>
        <span className="text-base font-semibold text-ink sm:text-lg">
          {over ? "Drop it!" : "Drop an EPUB here"}
        </span>
        <span className="text-sm text-muted">
          or click to choose a file
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".epub,application/epub+zip"
        className="sr-only"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

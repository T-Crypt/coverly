import { AlertCircle, CheckCircle2, X } from "lucide-react";

export interface Toast {
  id: number;
  text: string;
  kind: "ok" | "bad";
}

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export default function Toasts({ toasts, onDismiss }: Props) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border px-4 py-3 shadow-lift ${
            t.kind === "ok"
              ? "border-accent/30 bg-surface text-ink"
              : "border-danger/40 bg-danger-soft text-ink"
          }`}
        >
          {t.kind === "ok" ? (
            <CheckCircle2 className="size-5 shrink-0 text-accent" aria-hidden="true" />
          ) : (
            <AlertCircle className="size-5 shrink-0 text-danger" aria-hidden="true" />
          )}
          <p className="flex-1 text-sm">{t.text}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => onDismiss(t.id)}
            className="cursor-pointer rounded-md p-1 text-faint hover:text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

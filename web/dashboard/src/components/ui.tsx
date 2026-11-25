import { useEffect, useRef, useState, type ReactNode } from "react";
import { invalidate, type Fetched } from "@/lib/useFetch";

/** A soft letter mark. The tone comes from the name, so a connection keeps its color. */
export function Mark({ name, large }: { name: string; large?: boolean }) {
  const letter = (name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden="true" className={large ? "mark mark-large" : "mark"} data-tone={hash % 6}>
      {letter}
    </span>
  );
}

export function Chevron({ direction = "right" }: { direction?: "right" | "down" | "left" }) {
  return (
    <svg aria-hidden="true" className="chevron" data-direction={direction} fill="none" height="16" viewBox="0 0 16 16" width="16">
      <path d="m6 4 4 4-4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

export function ScreenHeader({ title, summary, action }: { title: ReactNode; summary?: ReactNode; action?: ReactNode }) {
  return (
    <div className="screen-head">
      <div>
        <h1>{title}</h1>
        {summary ? <p className="summary">{summary}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Loading and error for one request; the rest of the screen keeps working. */
export function Async<T>({ fetched, what, children }: { fetched: Fetched<T>; what: string; children: (data: T) => ReactNode }) {
  if (fetched.status === "loading") return <p className="loading">Loading {what}…</p>;
  if (fetched.status === "error") {
    return (
      <div className="notice notice-error" role="alert">
        <div>
          <strong>Could not load {what}</strong>
          <p>{fetched.error}</p>
        </div>
        <button className="button" onClick={invalidate} type="button">
          Try again
        </button>
      </div>
    );
  }
  return <>{children(fetched.data)}</>;
}

/** An identifier or URL an operator copies, with its copy button beside it. */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // No clipboard outside a secure context: select the text for a manual copy.
      const range = document.createRange();
      if (codeRef.current) range.selectNodeContents(codeRef.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }

  return (
    <div className="copy-value">
      <code ref={codeRef}>{value}</code>
      <button aria-label={copied ? `${label} copied` : `Copy ${label}`} className="button small" onClick={copy} type="button">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

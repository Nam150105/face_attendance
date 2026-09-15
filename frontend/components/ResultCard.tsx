"use client";

import type { ReactNode } from "react";

import { DataList } from "./ui";

/**
 * The one shape every post-capture answer takes: a mark, a headline, one
 * sentence, and the numbers folded away underneath. Green means the server
 * accepted, amber means it wants something from the person, red means no.
 */
export function ResultCard({
  tone,
  title,
  body,
  details,
  children,
}: {
  tone: "success" | "warning" | "danger";
  title: string;
  body?: ReactNode;
  /** Measurements behind the verdict; shown only on request. */
  details?: Array<{ key: string; value: ReactNode }>;
  children?: ReactNode;
}) {
  return (
    <section className={`result result--${tone}`} role="status" aria-live="polite">
      <div className="result__mark" aria-hidden="true">
        {tone === "success" ? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : tone === "warning" ? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M12 8v5" />
            <circle cx="12" cy="17" r="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        )}
      </div>
      <h2 className="result__title">{title}</h2>
      {body ? <p className="result__body">{body}</p> : null}
      {children}
      {details && details.length > 0 ? (
        <details className="disclosure result__details">
          <summary>Chi tiết kỹ thuật</summary>
          <DataList rows={details} />
        </details>
      ) : null}
    </section>
  );
}

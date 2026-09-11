"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * A panel that slides in from the right and leaves the page visible behind it.
 *
 * A dialog covers the calendar the manager was just reading; a drawer sits
 * next to it, so picking another day is one click rather than close-then-click.
 * On a phone there is no "next to", and it becomes a full-height sheet.
 */
export function Drawer({
  title,
  subtitle,
  onClose,
  onBack,
  header,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** When given, a back arrow appears before the title: the drawer is on a second page. */
  onBack?: () => void;
  /** Replaces the default title block entirely. */
  header?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true" tabIndex={-1} ref={panelRef}>
        <header className="drawer__header">
          {onBack ? (
            <button type="button" className="drawer__icon" onClick={onBack} aria-label="Quay lại">
              ←
            </button>
          ) : null}
          {header ?? (
            <div className="drawer__heading">
              <h2 className="drawer__title">{title}</h2>
              {subtitle ? <p className="drawer__subtitle">{subtitle}</p> : null}
            </div>
          )}
          <button type="button" className="drawer__icon" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </header>
        <div className="drawer__body">{children}</div>
      </aside>
    </div>
  );
}

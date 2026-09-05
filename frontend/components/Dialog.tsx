"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { Button } from "./ui";

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus and scroll-lock run once. Re-running them on every render would steal
  // focus from the field being typed into, which dismisses the mobile keyboard.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panelRef}>
        <header className="dialog__header">
          <h2 className="dialog__title">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Đóng">
            ✕
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}

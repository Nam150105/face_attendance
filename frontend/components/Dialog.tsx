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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
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

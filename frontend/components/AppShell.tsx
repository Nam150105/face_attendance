"use client";

import type { ReactNode } from "react";

import { Shell } from "./Shell";

/**
 * Kept as a name because a dozen pages import it. Every role now gets the same
 * frame; `wide` used to pick between two column widths and the narrow column is
 * still worth having for the focused flows — enrolment and check-in.
 */
export function AppShell({
  wide,
  children,
}: {
  email?: string | null;
  wide?: boolean;
  children: ReactNode;
}) {
  return <Shell narrow={!wide}>{children}</Shell>;
}

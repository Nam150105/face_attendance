"use client";

import type { ReactNode } from "react";

import { Shell } from "./Shell";

/** One frame for everybody; the sidebar decides what a role can reach. */
export function AdminShell({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}

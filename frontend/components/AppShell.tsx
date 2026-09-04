"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { api } from "../lib/api";
import { Button } from "./ui";

export function AppShell({ email, children }: { email?: string | null; children: ReactNode }) {
  const router = useRouter();

  async function signOut() {
    await api.logout();
    router.replace("/login");
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden="true">
            FA
          </span>
          Face Attendance
        </div>
        {email ? (
          <div className="topbar__meta">
            <span>{email}</span>
            <Button variant="ghost" onClick={() => void signOut()}>
              Đăng xuất
            </Button>
          </div>
        ) : null}
      </header>
      <main>{children}</main>
    </div>
  );
}

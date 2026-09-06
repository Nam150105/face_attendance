"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { api } from "../lib/api";
import { NetworkBanner } from "./NetworkBanner";
import { Button } from "./ui";

function initials(email: string): string {
  const namePart = email.split("@")[0] || "FA";
  const letters = namePart.split(/[._-]+/).filter(Boolean);
  return (letters.length > 1 ? letters[0][0] + letters[1][0] : namePart.slice(0, 2)).toUpperCase();
}

/**
 * `wide` is for the data-dense member pages (history, corrections). The focused
 * flows — login, enrolment, check-in — read better in the narrow column.
 */
export function AppShell({
  email,
  wide,
  children,
}: {
  email?: string | null;
  wide?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        new Intl.DateTimeFormat("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(now),
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  async function signOut() {
    await api.logout();
    router.replace("/login");
  }

  return (
    <div className={`shell ${wide ? "shell--wide" : ""}`}>
      <header className="topbar">
        <Link href="/" className="topbar__brand">
          <img src="/logo.svg" alt="Logo Face Attendance" className="topbar__logo" />
          <div className="topbar__brand-text">
            <span className="topbar__brand-title">Face Attendance</span>
            <span className="topbar__brand-badge">Quản lý hiện diện</span>
          </div>
        </Link>
        {email ? (
          <div className="topbar__meta">
            {time ? (
              <span className="user-badge mono" style={{ fontSize: "12px", color: "var(--color-cyan)" }}>
                {time}
              </span>
            ) : null}
            <div className="user-badge" title={email}>
              <span className="user-badge__avatar">{initials(email)}</span>
              <span
                className="user-badge__email"
                style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {email}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Đăng xuất
            </Button>
          </div>
        ) : null}
      </header>
      <NetworkBanner />
      <main>{children}</main>
    </div>
  );
}

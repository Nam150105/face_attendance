"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { NetworkBanner } from "./NetworkBanner";
import { Alert, Button, LoadingRows } from "./ui";

const LINKS = [
  {
    href: "/manager",
    label: "Tổng quan",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <rect width="7" height="5" x="14" y="3" rx="1" />
        <rect width="7" height="9" x="14" y="12" rx="1" />
        <rect width="7" height="5" x="3" y="16" rx="1" />
      </svg>
    ),
  },
  {
    href: "/manager/attendance",
    label: "Bản ghi",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    href: "/manager/members",
    label: "Thành viên",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: "/manager/locations",
    label: "Địa điểm",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    href: "/manager/corrections",
    label: "Chỉnh công",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
  {
    href: "/manager/audit-logs",
    label: "Nhật ký",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
];

function initials(email: string): string {
  const namePart = email.split("@")[0] || "MN";
  const letters = namePart.split(/[._-]+/).filter(Boolean);
  return (letters.length > 1 ? letters[0][0] + letters[1][0] : namePart.slice(0, 2)).toUpperCase();
}

export function ManagerShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
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

  useEffect(() => {
    api
      .me()
      .then((user) => {
        if (user.role !== "MANAGER") {
          setDenied(true);
          return;
        }
        setEmail(user.email);
      })
      .catch((cause) => {
        if (cause instanceof ApiError && cause.statusCode === 401) {
          router.replace("/login");
          return;
        }
        setDenied(true);
      });
  }, [router]);

  async function signOut() {
    await api.logout();
    router.replace("/login");
  }

  if (denied) {
    return (
      <div className="shell">
        <Alert tone="danger">Khu vực này chỉ dành cho tài khoản quản trị.</Alert>
        <Button variant="secondary" onClick={() => router.replace("/")}>
          Quay lại trang chính
        </Button>
      </div>
    );
  }

  return (
    <div className="shell shell--wide">
      <header className="topbar">
        <Link href="/manager" className="topbar__brand">
          <img src="/logo.svg" alt="Logo Face Attendance" className="topbar__logo" />
          <div className="topbar__brand-text">
            <span className="topbar__brand-title">Face Attendance</span>
            <span className="topbar__brand-badge">Bảng quản trị</span>
          </div>
        </Link>
        <div className="topbar__meta">
          {time ? (
            <span className="user-badge mono" style={{ fontSize: "12px", color: "var(--color-cyan)" }}>
              {time}
            </span>
          ) : null}
          {email ? (
            <div className="user-badge" title={email}>
              <span className="user-badge__avatar" style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}>
                {initials(email)}
              </span>
              <span
                className="user-badge__email"
                style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {email}
              </span>
            </div>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Đăng xuất
          </Button>
        </div>
      </header>

      <nav className="nav" aria-label="Điều hướng quản trị">
        {LINKS.map((link) => {
          const isActive = pathname === link.href || (link.href !== "/manager" && pathname.startsWith(link.href));
          return (
            <Link
              key={link.href}
              href={link.href}
              className="nav__link"
              aria-current={isActive ? "page" : undefined}
            >
              {link.icon}
              {link.label}
            </Link>
          );
        })}
      </nav>

      <NetworkBanner />

      <main>{email ? children : <LoadingRows count={4} />}</main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { NetworkBanner } from "./NetworkBanner";
import { Alert, Button, LoadingRows } from "./ui";
import { ApiError, api } from "../lib/api";
import { screenForPath, screensByGroup } from "../lib/screens";

interface Access {
  role: string;
  email: string;
  screens: string[];
}

const ROLE_LABEL: Record<string, string> = {
  MEMBER: "Thành viên",
  MANAGER: "Người quản lý",
  SUPER_ADMIN: "Quản trị hệ thống",
};

function initials(email: string): string {
  const namePart = email.split("@")[0] || "FA";
  const letters = namePart.split(/[._-]+/).filter(Boolean);
  return (letters.length > 1 ? letters[0][0] + letters[1][0] : namePart.slice(0, 2)).toUpperCase();
}

/**
 * One shell for everybody.
 *
 * Roles do not get different applications; they get the same one with a
 * different set of doors unlocked. The sidebar is built from what the server
 * says this account may open, and the server checks that again on every
 * request — hiding a link is presentation, not protection.
 */
export function Shell({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [access, setAccess] = useState<Access | null>(null);
  const [denied, setDenied] = useState(false);
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState("");

  useEffect(() => {
    api
      .myScreens()
      .then(setAccess)
      .catch((cause) => {
        if (cause instanceof ApiError && cause.statusCode === 401) {
          router.replace("/login");
          return;
        }
        setDenied(true);
      });
  }, [router]);

  useEffect(() => {
    const update = () =>
      setClock(
        new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  // A route change should not leave the mobile drawer covering the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function signOut() {
    try {
      await api.logout();
    } finally {
      router.replace("/login");
    }
  }

  if (denied) {
    return (
      <div className="shell">
        <Alert tone="danger">Không tải được thông tin tài khoản. Bạn thử tải lại trang nhé.</Alert>
        <Button onClick={() => router.replace("/login")}>Về trang đăng nhập</Button>
      </div>
    );
  }

  const sections = access ? screensByGroup(access.screens) : [];
  const current = screenForPath(pathname);
  const allowedHere = !access || !current || access.screens.includes(current.key);

  return (
    <div className={`layout${open ? " is-open" : ""}`}>
      <aside className="sidebar" aria-label="Điều hướng chính">
        <Link href="/" className="sidebar__brand">
          <img src="/logo.svg" alt="Logo Face Attendance" className="sidebar__logo" />
          <span className="sidebar__brand-text">
            <span className="sidebar__brand-title">Face Attendance</span>
            <span className="sidebar__brand-sub">
              {access ? (ROLE_LABEL[access.role] ?? access.role) : "Đang tải"}
            </span>
          </span>
        </Link>

        <nav className="sidebar__nav">
          {sections.map((section) => (
            <div className="sidebar__group" key={section.group}>
              <p className="sidebar__group-label">{section.group}</p>
              {section.items.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="sidebar__link"
                  aria-current={current?.key === item.key ? "page" : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
          {access === null ? <LoadingRows count={5} /> : null}
        </nav>
      </aside>

      <button
        type="button"
        className="layout__scrim"
        aria-label="Đóng menu"
        onClick={() => setOpen(false)}
        tabIndex={open ? 0 : -1}
      />

      <div className="layout__main">
        <header className="topbar">
          <button
            type="button"
            className="topbar__menu"
            aria-label="Mở menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="topbar__title">{current?.label ?? "Face Attendance"}</span>
          <div className="topbar__meta">
            {clock ? <span className="user-badge mono topbar__clock">{clock}</span> : null}
            {access ? (
              <div className="user-badge" title={access.email}>
                <span className="user-badge__avatar">{initials(access.email)}</span>
                <span className="user-badge__email">{access.email}</span>
              </div>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Đăng xuất
            </Button>
          </div>
        </header>

        <NetworkBanner />

        <main className={narrow ? "content content--narrow" : "content"}>
          {access === null ? (
            <LoadingRows count={4} />
          ) : allowedHere ? (
            children
          ) : (
            <Alert tone="warning">
              Tài khoản của bạn chưa được cấp quyền xem mục này. Nếu bạn cần dùng, hãy báo người quản
              trị hệ thống mở quyền giúp.
            </Alert>
          )}
        </main>
      </div>
    </div>
  );
}

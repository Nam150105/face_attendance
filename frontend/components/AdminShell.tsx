"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { NetworkBanner } from "./NetworkBanner";
import { Alert, Button, LoadingRows } from "./ui";

const LINKS = [
  { href: "/admin", label: "Tổng quan" },
  { href: "/admin/users", label: "Tài khoản" },
  { href: "/admin/attendance", label: "Bản ghi toàn hệ thống" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((user) => {
        if (user.role !== "SUPER_ADMIN") {
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
        <Alert tone="danger">Khu vực này chỉ dành cho quản trị hệ thống.</Alert>
        <Button variant="secondary" onClick={() => router.replace("/")}>
          Quay lại trang chính
        </Button>
      </div>
    );
  }

  return (
    <div className="shell shell--wide">
      <header className="topbar">
        <Link href="/admin" className="topbar__brand">
          <img src="/logo.svg" alt="Logo Face Attendance" className="topbar__logo" />
          <div className="topbar__brand-text">
            <span className="topbar__brand-title">Face Attendance</span>
            <span className="topbar__brand-badge topbar__brand-badge--admin">Quản trị hệ thống</span>
          </div>
        </Link>
        <div className="topbar__meta">
          {email ? (
            <div className="user-badge" title={email}>
              <span
                className="user-badge__avatar"
                style={{ background: "linear-gradient(135deg, #ef4444, #b91c1c)" }}
              >
                SA
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

      <nav className="nav" aria-label="Điều hướng quản trị hệ thống">
        {LINKS.map((link) => {
          const isActive = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
          return (
            <Link key={link.href} href={link.href} className="nav__link" aria-current={isActive ? "page" : undefined}>
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

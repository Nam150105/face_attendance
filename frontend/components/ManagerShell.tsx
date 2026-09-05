"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { Alert, Button, LoadingRows } from "./ui";

const LINKS = [
  { href: "/manager", label: "Tổng quan" },
  { href: "/manager/attendance", label: "Chấm công" },
  { href: "/manager/members", label: "Thành viên" },
  { href: "/manager/locations", label: "Địa điểm" },
  { href: "/manager/audit-logs", label: "Nhật ký" },
];

export function ManagerShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

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
        <Alert tone="danger">Khu vực này chỉ dành cho tài khoản MANAGER.</Alert>
        <Button variant="secondary" onClick={() => router.replace("/")}>
          Về trang chính
        </Button>
      </div>
    );
  }

  return (
    <div className="shell shell--wide">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden="true">
            FA
          </span>
          Quản lý chấm công
        </div>
        <div className="topbar__meta">
          {email ? <span>{email}</span> : null}
          <Button variant="ghost" onClick={() => void signOut()}>
            Đăng xuất
          </Button>
        </div>
      </header>

      <nav className="nav" aria-label="Điều hướng quản lý">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="nav__link"
            aria-current={pathname === link.href ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <main>{email ? children : <LoadingRows count={4} />}</main>
    </div>
  );
}

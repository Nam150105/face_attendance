"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "../lib/api";

const LINKS = [
  { href: "/", label: "Trang chủ" },
  { href: "/history", label: "Lịch sử" },
  { href: "/schedule", label: "Lịch làm việc" },
  { href: "/locations", label: "Địa điểm" },
  { href: "/corrections", label: "Chỉnh công" },
  { href: "/notifications", label: "Thông báo" },
  { href: "/profile", label: "Hồ sơ" },
];

export function MemberNav() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    // A failure here must not disturb the page: the badge is decoration.
    api
      .notifications({ limit: 1 })
      .then((result) => setUnread(result.unread))
      .catch(() => setUnread(0));
  }, [pathname]);

  return (
    <nav className="nav" aria-label="Điều hướng thành viên">
      {LINKS.map((link) => {
        const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className="nav__link"
            aria-current={isActive ? "page" : undefined}
          >
            {link.label}
            {link.href === "/notifications" && unread > 0 ? (
              <span className="nav__badge" aria-label={`${unread} thông báo chưa đọc`}>
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

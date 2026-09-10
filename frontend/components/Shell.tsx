"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { NetworkBanner } from "./NetworkBanner";
import { Alert, Button, LoadingRows } from "./ui";
import { ApiError, api } from "../lib/api";
import { landingScreen, screenForPath, screensByGroup } from "../lib/screens";
import { readTokens } from "../lib/session";

interface Access {
  role: string;
  email: string;
  screens: string[];
  has_face_photo?: boolean;
}

/** The only page that renders without a session. */
const PUBLIC_PATH = "/login";

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
  // Undefined until the browser has been asked; there are no tokens during the
  // server render, and treating that as "signed out" would flash the login
  // frame at people who are signed in.
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [face, setFace] = useState<string | null>(null);
  // Every group starts open: with the menu down to a handful of items, hiding
  // half of them costs a click on every visit and saves nothing. Collapsing is
  // there for whoever wants it, and it is remembered while the tab is open.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSignedIn(readTokens() !== null);
  }, [pathname]);

  // No session, and this is not the sign-in page: go there. Every other route
  // is somebody's data. Rendering an empty version of it and waiting for the
  // first request to come back 401 shows a broken page for no reason.
  useEffect(() => {
    if (signedIn === false && pathname !== PUBLIC_PATH) {
      router.replace(PUBLIC_PATH);
    }
  }, [pathname, router, signedIn]);

  useEffect(() => {
    if (signedIn !== true) {
      return;
    }
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
  }, [router, signedIn]);

  useEffect(() => {
    const update = () =>
      setClock(
        new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  // The registered face as the avatar: people should see which photo the
  // system matches them against, not two letters from their email.
  useEffect(() => {
    if (signedIn !== true || access?.has_face_photo !== true) {
      return;
    }
    let url: string | null = null;
    api
      .myFacePhoto()
      .then((value) => {
        url = value;
        setFace(value);
      })
      .catch(() => setFace(null));
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [signedIn, access?.has_face_photo]);

  // A route change should not leave the mobile drawer covering the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // A screen this account cannot open is not explained, it is left. Telling
  // somebody they lack a permission they cannot grant themselves gives them
  // nothing to do; sending them somewhere useful does.
  useEffect(() => {
    if (!access) {
      return;
    }
    const screen = screenForPath(pathname);
    if (screen && !access.screens.includes(screen.key)) {
      router.replace(landingScreen(access.screens, access.role));
    }
  }, [access, pathname, router]);

  async function signOut() {
    try {
      await api.logout();
    } finally {
      router.replace("/login");
    }
  }

  // Sign-in and password recovery run before there is an account to ask about.
  // Wrapping them in the sidebar meant asking the server who this person is,
  // getting a 401, and redirecting to the page they were already on — the form
  // never rendered and nobody could log in.
  if (signedIn === false && pathname === PUBLIC_PATH) {
    return (
      <div className="public-frame">
        <div className="public-frame__brand">
          <img src="/logo.svg" alt="Logo Face Attendance" width={36} height={36} />
          <span>Face Attendance</span>
        </div>
        <main className="content content--narrow">{children}</main>
      </div>
    );
  }

  // Either the browser has not been asked yet, or the redirect above is on its
  // way. Both are a moment of waiting, not a page.
  if (signedIn !== true) {
    return (
      <div className="public-frame">
        <main className="content content--narrow">
          <LoadingRows count={3} />
        </main>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="shell">
        <Alert tone="danger">Không tải được thông tin tài khoản. Bạn thử tải lại trang nhé.</Alert>
        <Button onClick={() => router.replace("/login")}>Về trang đăng nhập</Button>
      </div>
    );
  }

  const sections = access ? screensByGroup(access.screens, access.role) : [];
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
          {sections.map((section) => {
            const open = collapsed[section.group] ?? true;
            return (
              <div className="sidebar__group" key={section.group}>
                <button
                  type="button"
                  className="sidebar__group-label"
                  aria-expanded={open}
                  onClick={() =>
                    setCollapsed((state) => ({ ...state, [section.group]: !open }))
                  }
                >
                  <span>{section.group}</span>
                  <span className="sidebar__chevron" aria-hidden="true">
                    {open ? "−" : "+"}
                  </span>
                </button>
                {open
                  ? section.items.map((item) => (
                      <Link
                        key={item.key}
                        href={item.href}
                        className="sidebar__link"
                        aria-current={current?.key === item.key ? "page" : undefined}
                      >
                        {item.label}
                      </Link>
                    ))
                  : null}
              </div>
            );
          })}
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
              <Link href="/profile" className="user-badge user-badge--link" title="Mở hồ sơ cá nhân">
                {face ? (
                  <img src={face} alt="" className="user-badge__face" />
                ) : (
                  <span className="user-badge__avatar">{initials(access.email)}</span>
                )}
                <span className="user-badge__email">{access.email}</span>
              </Link>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Đăng xuất
            </Button>
          </div>
        </header>

        <NetworkBanner />

        <main className={narrow ? "content content--narrow" : "content"}>
          {access === null || !allowedHere ? <LoadingRows count={4} /> : children}
        </main>
      </div>
    </div>
  );
}

/**
 * Every screen in the system, in one list.
 *
 * There is a single interface: what a person sees is decided by which screens
 * their role may open, not by which of three different apps they logged into.
 * The keys match `role_permissions.screen` on the server, and the server checks
 * the same table again on every endpoint — this list only decides what the
 * sidebar draws.
 */

export interface ScreenDefinition {
  key: string;
  href: string;
  label: string;
  group: string;
  /** Longest-prefix matching decides the active item, so order does not matter. */
  match?: string[];
  /**
   * Reachable, but not drawn in the sidebar.
   *
   * Approving people, places and requests is one job done from one screen, so
   * those pages moved inside "Quản lý nhóm". They keep their own screen key
   * because the server still checks it per endpoint; what changed is that a
   * manager no longer hunts for them in a menu of fourteen items.
   */
  hidden?: boolean;
}

export const GROUPS = ["Chấm công", "Quản lý", "Hệ thống"] as const;

/**
 * Which group comes first depends on why you opened the app.
 *
 * A member came to check in. A manager came to see who turned up. Putting the
 * same order in front of both means one of them scrolls past somebody else's
 * work every single time.
 */
const GROUP_ORDER: Record<string, readonly string[]> = {
  MEMBER: ["Chấm công", "Quản lý", "Hệ thống"],
  MANAGER: ["Quản lý", "Chấm công", "Hệ thống"],
  SUPER_ADMIN: ["Hệ thống", "Quản lý", "Chấm công"],
};

export const SCREENS: ScreenDefinition[] = [
  { key: "home", href: "/", label: "Trang chủ", group: "Chấm công" },
  { key: "attendance", href: "/attendance", label: "Chấm công", group: "Chấm công", match: ["/attendance", "/enroll"] },
  { key: "history", href: "/history", label: "Lịch sử của tôi", group: "Chấm công" },
  { key: "my-locations", href: "/locations", label: "Nơi chấm công", group: "Chấm công" },
  { key: "my-corrections", href: "/corrections", label: "Yêu cầu chỉnh công", group: "Chấm công" },
  { key: "notifications", href: "/notifications", label: "Thông báo", group: "Chấm công" },
  { key: "profile", href: "/profile", label: "Hồ sơ", group: "Chấm công" },

  { key: "team-overview", href: "/manager", label: "Tổng quan nhóm", group: "Quản lý" },
  { key: "records", href: "/manager/attendance", label: "Bản ghi", group: "Quản lý" },
  {
    key: "members",
    href: "/manager/teams",
    label: "Quản lý nhóm",
    group: "Quản lý",
    // Units and the people in them are one subject; splitting them across two
    // menu entries made a manager hop back and forth to do one job.
    match: ["/manager/teams"],
  },
  { key: "join-requests", href: "/manager/join-requests", label: "Yêu cầu vào nhóm", group: "Quản lý", hidden: true },
  { key: "face-requests", href: "/manager/face-requests", label: "Đổi khuôn mặt", group: "Quản lý", hidden: true },
  { key: "locations", href: "/manager/locations", label: "Địa điểm", group: "Quản lý", hidden: true },
  { key: "corrections", href: "/manager/corrections", label: "Duyệt chỉnh công", group: "Quản lý", hidden: true },
  { key: "audit", href: "/manager/audit-logs", label: "Nhật ký", group: "Quản lý" },

  { key: "admin-overview", href: "/admin", label: "Tổng quan hệ thống", group: "Hệ thống" },
  { key: "admin-users", href: "/admin/users", label: "Tài khoản", group: "Hệ thống" },
  { key: "admin-records", href: "/admin/attendance", label: "Toàn bộ bản ghi", group: "Hệ thống" },
  { key: "admin-roles", href: "/admin/roles", label: "Phân quyền", group: "Hệ thống" },
  { key: "admin-data", href: "/admin/data", label: "Dữ liệu hệ thống", group: "Hệ thống" },
  { key: "admin-errors", href: "/admin/errors", label: "Sự cố hệ thống", group: "Hệ thống" },
];

const BY_HREF = new Map(SCREENS.map((screen) => [screen.href, screen]));

/**
 * Which screen a path belongs to. Longest prefix wins, so /manager/attendance
 * resolves to the records screen rather than the team overview at /manager.
 */
export function screenForPath(pathname: string): ScreenDefinition | undefined {
  if (BY_HREF.has(pathname)) {
    return BY_HREF.get(pathname);
  }
  let best: ScreenDefinition | undefined;
  for (const screen of SCREENS) {
    for (const prefix of screen.match ?? [screen.href]) {
      if (prefix !== "/" && pathname.startsWith(prefix) && (!best || prefix.length > best.href.length)) {
        best = screen;
      }
    }
  }
  return best;
}

export function screensByGroup(
  allowed: string[],
  role: string,
): { group: string; items: ScreenDefinition[] }[] {
  const permitted = new Set(allowed);
  const order = GROUP_ORDER[role] ?? GROUPS;
  return order
    .map((group) => ({
      group,
      items: SCREENS.filter(
        (screen) => screen.group === group && !screen.hidden && permitted.has(screen.key),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

/** Where to land after signing in: the first thing this account can actually do. */
export function landingScreen(allowed: string[], role: string): string {
  return screensByGroup(allowed, role)[0]?.items[0]?.href ?? "/profile";
}

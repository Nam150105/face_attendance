/**
 * Words and small computations shared by every records view.
 *
 * The calendar, the table, the roll call and the drawer all describe the
 * same rows; keeping the vocabulary here is what stops one of them calling a
 * day "Đủ vào ra" while another calls it "Đúng giờ".
 */
import type { AttendanceStatus, CalendarDayStatus, DaySession, RollCallStatus } from "./types";
import { describeMinutes } from "./member";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const DAY_STATUS: Record<CalendarDayStatus, { label: string; tone: Tone; dot: string }> = {
  ON_TIME: { label: "Đúng giờ", tone: "success", dot: "var(--color-success)" },
  LATE: { label: "Đi muộn", tone: "danger", dot: "var(--color-danger)" },
  OPEN: { label: "Chưa ra ca", tone: "warning", dot: "var(--color-warning)" },
  NO_CHECK_IN: { label: "Thiếu lượt vào", tone: "warning", dot: "var(--color-warning)" },
  REJECTED_FACE: { label: "Khuôn mặt không khớp", tone: "neutral", dot: "var(--text-muted)" },
  REJECTED_PLACE: { label: "Địa điểm không khớp", tone: "neutral", dot: "var(--text-muted)" },
};

export const ROLL_STATUS: Record<RollCallStatus, { label: string; tone: Tone; dot: string }> = {
  PRESENT: { label: "Đủ vào ra", tone: "success", dot: "var(--color-success)" },
  LATE: { label: "Đi muộn", tone: "danger", dot: "var(--color-danger)" },
  OPEN: { label: "Đang làm", tone: "warning", dot: "var(--color-warning)" },
  ABSENT: { label: "Chưa chấm công", tone: "neutral", dot: "var(--text-muted)" },
};

/** The four words a single record can carry; the edit form uses the same list. */
export const EVENT_STATUS: Record<AttendanceStatus, { label: string; tone: Tone }> = {
  SUCCESS: { label: "Hợp lệ", tone: "success" },
  WARNING_CONFIRMED: { label: "Hợp lệ có lý do", tone: "warning" },
  BLOCKED: { label: "Địa điểm không khớp", tone: "danger" },
  FAILED: { label: "Khuôn mặt không khớp", tone: "danger" },
};

export const SOURCE_LABEL: Record<string, string> = {
  DEVICE: "Thiết bị chấm công",
  CORRECTION: "Chỉnh công đã duyệt",
  MANUAL: "Người quản lý nhập",
};

export function monthKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

export function localDateKey(date: Date): string {
  return `${monthKey(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Monday-first grid, padded so week rows always line up under the headings. */
export function buildGrid(month: string): (string | null)[] {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(year, monthIndex - 1, 1);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

const WEEKDAY_LONG = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

/** "2026-09-11" → "Thứ Sáu, 11/09/2026". */
export function longDate(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return `${WEEKDAY_LONG[date.getDay()]}, ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

export function shortDate(key: string): string {
  return key.split("-").reverse().join("/");
}

export function clock(value: string | null): string {
  return value ? new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—";
}

export function initials(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "?";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  // Family name and given name: "Lê Thành Viên" is LV, the way a Vietnamese
  // name is usually abbreviated.
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

/** Time between arriving and leaving; nothing yet if the day is still open. */
export function presenceOf(session: { check_in: string | null; check_out: string | null }): string {
  if (!session.check_in || !session.check_out) {
    return "Chưa ra ca";
  }
  const minutes = Math.round((new Date(session.check_out).getTime() - new Date(session.check_in).getTime()) / 60000);
  return minutes > 0 ? describeMinutes(minutes) : "0 phút";
}

/** "Muộn 43'" / "Về sớm 12'" / "Đúng giờ" — the short form for a pill. */
export function timingPill(session: { minutes_late: number; minutes_early_leave: number; check_in: string | null; check_out: string | null }): { label: string; tone: Tone } {
  if (!session.check_in) {
    return { label: "Chưa chấm công", tone: "neutral" };
  }
  if (session.minutes_late > 0) {
    return { label: `Muộn ${session.minutes_late}'`, tone: "danger" };
  }
  if (!session.check_out) {
    return { label: "Chưa ra ca", tone: "warning" };
  }
  if (session.minutes_early_leave > 0) {
    return { label: `Về sớm ${session.minutes_early_leave}'`, tone: "warning" };
  }
  return { label: "Đúng giờ", tone: "success" };
}

/** The line under a calendar day: who came, and what needs a look. */
export function summariseDay(people: { check_in: string | null; check_out: string | null; minutes_late: number }[]) {
  const present = people.filter((person) => person.check_in !== null);
  return {
    people: present.length,
    late: present.filter((person) => person.minutes_late > 0).length,
    open: present.filter((person) => person.check_out === null).length,
    refused: people.length - present.length,
  };
}

export function exportSessionsCsv(day: string, sessions: DaySession[]) {
  const headers = ["Ngày", "Họ và tên", "Email", "Giờ vào", "Giờ ra", "Đi muộn (phút)", "Về sớm (phút)", "Nơi", "Tình trạng"];
  const rows = sessions.map((session) => [
    session.work_date,
    session.member_name ?? "",
    session.member_email,
    session.check_in ? new Date(session.check_in).toLocaleTimeString("vi-VN") : "",
    session.check_out ? new Date(session.check_out).toLocaleTimeString("vi-VN") : "",
    String(session.minutes_late),
    String(session.minutes_early_leave),
    session.location_name ?? "",
    DAY_STATUS[session.status].label,
  ]);
  // The BOM is what makes Excel read Vietnamese instead of mojibake.
  const csv =
    "﻿" +
    [headers, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `cham-cong-${day}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

import type { AttendanceDayEvent, CorrectionStatus, CorrectionType, DayStatus } from "./types";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const DAY_STATUS: Record<DayStatus, { label: string; tone: Tone }> = {
  VALID: { label: "Đủ công", tone: "success" },
  LATE: { label: "Đến muộn", tone: "warning" },
  MISSING_CHECK_OUT: { label: "Quên bấm giờ ra", tone: "warning" },
  INVALID: { label: "Chấm công không thành", tone: "danger" },
  ABSENT: { label: "Không đi làm", tone: "neutral" },
};

export const CORRECTION_TYPE: Record<CorrectionType, string> = {
  MISSING_CHECK_IN: "Quên bấm giờ vào",
  MISSING_CHECK_OUT: "Quên bấm giờ ra",
  WRONG_TIME: "Giờ ghi nhận bị sai",
  OTHER: "Việc khác",
};

export const CORRECTION_STATUS: Record<CorrectionStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Chờ duyệt", tone: "info" },
  APPROVED: { label: "Đã duyệt", tone: "success" },
  REJECTED: { label: "Bị từ chối", tone: "danger" },
};

export const NOTIFICATION_CATEGORY: Record<string, { label: string; tone: Tone }> = {
  CHECK_IN: { label: "Giờ vào", tone: "success" },
  CHECK_OUT: { label: "Giờ ra", tone: "info" },
  LATE: { label: "Đến muộn", tone: "warning" },
  EARLY_LEAVE: { label: "Về sớm", tone: "warning" },
  AUTO_CHECK_OUT: { label: "Tự kết thúc", tone: "warning" },
  SCHEDULE_CHANGED: { label: "Đổi giờ làm việc", tone: "info" },
  CORRECTION_REVIEWED: { label: "Kết quả xin sửa", tone: "neutral" },
};

const WEEKDAYS = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

export function weekdayLabel(weekday: number | null): string {
  return weekday === null ? "—" : WEEKDAYS[weekday] ?? "—";
}

/** "08:00:00" -> "08:00"; the seconds are never meaningful for a shift. */
export function shortTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return value.slice(0, 5);
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null || minutes === undefined) {
    return "—";
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${rest} phút`;
  }
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest} phút`;
}

export function clockOf(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function dayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  return `${WEEKDAYS[date.getDay()]}, ${new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  }).format(date)}`;
}

/** First and last day of a month, as the yyyy-mm-dd the API expects. */
export function monthRange(monthValue: string): { date_from: string; date_to: string } {
  const [year, month] = monthValue.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return { date_from: first.toISOString().slice(0, 10), date_to: last.toISOString().slice(0, 10) };
}

export function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** "95" -> "1 giờ 35 phút". Mirrors describe_duration on the server. */
export function describeMinutes(minutes: number | null): string {
  if (!minutes) {
    return "—";
  }
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  if (hours && rest) {
    return `${hours} giờ ${rest} phút`;
  }
  return hours ? `${hours} giờ` : `${rest} phút`;
}

export interface SessionPair {
  key: string;
  checkIn: AttendanceDayEvent | null;
  checkOut: AttendanceDayEvent | null;
  rejected: AttendanceDayEvent[];
}

/**
 * Turn a flat stream of attempts into the in/out pairs a person actually thinks
 * in. Successful events open and close a session; refused attempts are attached
 * to the session they were trying to affect so they are visible without
 * pretending they counted.
 */
export function pairSessions(events: AttendanceDayEvent[]): SessionPair[] {
  const counted = (event: AttendanceDayEvent) =>
    event.status === "SUCCESS" || event.status === "WARNING_CONFIRMED";

  const pairs: SessionPair[] = [];
  let current: SessionPair | null = null;

  for (const event of events) {
    if (!counted(event)) {
      if (current) {
        current.rejected.push(event);
      } else {
        pairs.push({ key: event.id, checkIn: null, checkOut: null, rejected: [event] });
      }
      continue;
    }
    if (event.event_type === "CHECK_IN") {
      current = { key: event.id, checkIn: event, checkOut: null, rejected: [] };
      pairs.push(current);
      continue;
    }
    if (current && !current.checkOut) {
      current.checkOut = event;
      current = null;
    } else {
      // A check-out with no matching check-in: still show it rather than drop it.
      pairs.push({ key: event.id, checkIn: null, checkOut: event, rejected: [] });
    }
  }
  return pairs;
}

export function pairDuration(pair: SessionPair): number | null {
  if (!pair.checkIn || !pair.checkOut) {
    return null;
  }
  const ms = new Date(pair.checkOut.server_time).getTime() - new Date(pair.checkIn.server_time).getTime();
  return ms > 0 ? Math.floor(ms / 60000) : null;
}

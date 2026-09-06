import type { AuditLogEntry } from "./types";

const ACTION_LABELS: Record<string, string> = {
  MEMBER_ADDED: "Thêm thành viên",
  MEMBERSHIP_REACTIVATED: "Kích hoạt lại thành viên",
  MEMBERSHIP_STATUS_CHANGED: "Đổi trạng thái thành viên",
  MEMBERSHIP_REMOVED: "Gỡ thành viên",
  LOCATION_CREATED: "Tạo địa điểm",
  LOCATION_UPDATED: "Sửa địa điểm",
  LOCATION_DEACTIVATED: "Tắt địa điểm",
  LOCATION_ASSIGNED: "Gán địa điểm",
  LOCATION_UNASSIGNED: "Gỡ địa điểm",
  ATTENDANCE_MANUALLY_ADJUSTED: "Điều chỉnh bản ghi",
};

const FIELD_LABELS: Record<string, string> = {
  status: "Trạng thái",
  server_time: "Thời gian",
  name: "Tên",
  address: "Địa chỉ",
  latitude: "Vĩ độ",
  longitude: "Kinh độ",
  allow_radius_meters: "Phạm vi cho phép",
  warning_radius_meters: "Phạm vi cảnh báo",
  is_active: "Đang bật",
  location_id: "Địa điểm",
  is_default: "Mặc định",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Đang hoạt động",
  SUSPENDED: "Tạm ngưng",
  REMOVED: "Đã gỡ",
  INVITED: "Đã mời",
  SUCCESS: "Hợp lệ",
  WARNING_CONFIRMED: "Cảnh báo đã xác nhận",
  BLOCKED: "Bị chặn",
  FAILED: "Không hợp lệ",
};

export type AuditTone = "neutral" | "success" | "warning" | "danger";

export function auditLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function auditTone(action: string): AuditTone {
  if (action.includes("ADJUSTED")) {
    return "warning";
  }
  if (action.includes("REMOVED") || action.includes("DEACTIVATED")) {
    return "danger";
  }
  if (action.includes("CREATED") || action.includes("ADDED") || action.includes("ASSIGNED")) {
    return "success";
  }
  return "neutral";
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "trống";
  }
  if (typeof value === "boolean") {
    return value ? "có" : "không";
  }
  const text = String(value);
  if (STATUS_LABELS[text]) {
    return STATUS_LABELS[text];
  }
  // ISO timestamps read better as local time.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(parsed);
    }
  }
  if (text.length > 40) {
    return `${text.slice(0, 37)}…`;
  }
  return text;
}

export interface AuditChange {
  field: string;
  before: string | null;
  after: string | null;
}

/** Turn before/after JSON into a short list of human-readable field changes. */
export function auditChanges(entry: AuditLogEntry): AuditChange[] {
  const before = entry.before_json ?? {};
  const after = entry.after_json ?? {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changes: AuditChange[] = [];

  for (const key of keys) {
    const previous = (before as Record<string, unknown>)[key];
    const next = (after as Record<string, unknown>)[key];
    if (JSON.stringify(previous) === JSON.stringify(next)) {
      continue;
    }
    changes.push({
      field: FIELD_LABELS[key] ?? key,
      before: entry.before_json ? renderValue(previous) : null,
      after: entry.after_json ? renderValue(next) : null,
    });
  }
  return changes;
}

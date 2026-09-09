"use client";

import { useCallback, useEffect, useState } from "react";

import { AttendanceCalendar } from "../../../components/AttendanceCalendar";
import { Dialog } from "../../../components/Dialog";
import { usePermissions } from "../../../lib/permissions";
import { ManagerShell } from "../../../components/ManagerShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataList,
  Empty,
  Field,
  LoadingRows,
  SelectField,
  TextAreaField,
} from "../../../components/ui";
import { api } from "../../../lib/api";
import { formatDateTime, formatDistance } from "../../../lib/geo";
import { describeError, describeFailure } from "../../../lib/messages";
import { describeMinutes } from "../../../lib/member";
import type {
  AttendanceFilters,
  LoginHistory,
  AttendanceStatus,
  ManagedMember,
  ManagerAttendanceEvent,
  ManagerLocation,
} from "../../../lib/types";

const PAGE_SIZE = 25;

const STATUS_TONE: Record<AttendanceStatus, "success" | "warning" | "danger"> = {
  SUCCESS: "success",
  WARNING_CONFIRMED: "warning",
  BLOCKED: "danger",
  FAILED: "danger",
};

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  SUCCESS: "Hợp lệ",
  WARNING_CONFIRMED: "Hợp lệ có lý do",
  BLOCKED: "Ngoài phạm vi",
  FAILED: "Không hợp lệ",
};

function exportToCsv(events: ManagerAttendanceEvent[]) {
  if (!events || events.length === 0) {
    alert("Không có dữ liệu để xuất.");
    return;
  }
  const headers = [
    "Mã bản ghi",
    "Họ và tên",
    "Email",
    "Loại sự kiện",
    "Địa điểm",
    "Thời điểm ghi nhận",
    "Khoảng cách (mét)",
    "Trạng thái",
    "Lý do",
    "Mã lỗi",
  ];

  const rows = events.map((e) => [
    `"${e.id}"`,
    `"${e.member_name ?? ""}"`,
    `"${e.member_email}"`,
    `"${e.event_type === "CHECK_IN" ? "Check-in" : "Check-out"}"`,
    `"${e.location_name}"`,
    `"${new Date(e.server_time).toLocaleString("vi-VN")}"`,
    `"${e.distance_meters.toFixed(1)}"`,
    `"${STATUS_LABELS[e.status] ?? e.status}"`,
    `"${(e.reason ?? "").replace(/"/g, '""')}"`,
    `"${e.failure_code ?? ""}"`,
  ]);

  // UTF-8 BOM (\uFEFF) ensures Vietnamese characters open perfectly in Excel
  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const today = new Date().toISOString().split("T")[0];
  link.setAttribute("download", `bao-cao-ghi-nhan-${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const LOGIN_LABEL: Record<string, string> = {
  SUCCESS: "Vào được",
  BAD_PASSWORD: "Sai mật khẩu",
  NO_ACCOUNT: "Không có tài khoản",
  SUSPENDED: "Tài khoản bị khoá",
  RATE_LIMITED: "Bị chặn tạm thời",
};

const LOGIN_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  SUCCESS: "success",
  BAD_PASSWORD: "warning",
  NO_ACCOUNT: "neutral",
  SUSPENDED: "danger",
  RATE_LIMITED: "danger",
};

/** A run of wrong passwords ending in a block is what a lockout looks like. */
function LOGIN_SUMMARY(totals: Record<string, number>): string {
  const parts: string[] = [];
  if (totals.SUCCESS) parts.push(`${totals.SUCCESS} lần vào được`);
  if (totals.BAD_PASSWORD) parts.push(`${totals.BAD_PASSWORD} lần sai mật khẩu`);
  if (totals.RATE_LIMITED) parts.push(`${totals.RATE_LIMITED} lần bị chặn vì thử quá nhiều`);
  if (totals.SUSPENDED) parts.push(`${totals.SUSPENDED} lần vào khi tài khoản đang khoá`);
  return parts.length > 0 ? parts.join(" · ") : "Chưa có lần đăng nhập nào được ghi lại.";
}

/** The browser and system, without the version soup nobody reads. */
function shortDevice(userAgent: string | null): string {
  if (!userAgent) {
    return "—";
  }
  const system = /Android/i.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iOS/i.test(userAgent)
      ? "iOS"
      : /Windows/i.test(userAgent)
        ? "Windows"
        : /Mac OS/i.test(userAgent)
          ? "macOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "Khác";
  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /Chrome\//i.test(userAgent)
      ? "Chrome"
      : /Safari\//i.test(userAgent)
        ? "Safari"
        : /Firefox\//i.test(userAgent)
          ? "Firefox"
          : "Trình duyệt khác";
  return `${browser} trên ${system}`;
}

interface Session {
  work_date: string;
  member_id: string;
  member_email: string;
  member_name: string | null;
  check_in: string | null;
  check_out: string | null;
  minutes_late: number;
  minutes_early_leave: number;
  rejected: number;
  location_name: string | null;
  check_in_id: string | null;
  check_out_id: string | null;
  status: "ON_TIME" | "LATE" | "OPEN" | "REJECTED";
}

const SESSION_LABEL: Record<Session["status"], string> = {
  ON_TIME: "Đủ vào ra",
  LATE: "Đi muộn",
  OPEN: "Chưa chấm ra",
  REJECTED: "Không chấm được",
};

const SESSION_TONE: Record<Session["status"], "success" | "warning" | "danger" | "neutral"> = {
  ON_TIME: "success",
  LATE: "danger",
  OPEN: "warning",
  REJECTED: "neutral",
};

function shortClock(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export default function ManagerAttendancePage() {
  const may = usePermissions("records");
  const [view, setView] = useState<"calendar" | "table">("calendar");
  const [search, setSearch] = useState("");
  // Refused attempts are not attendance; they are shown only when asked for.
  const [includeInvalid, setIncludeInvalid] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [filters, setFilters] = useState<AttendanceFilters>({});
  const [page, setPage] = useState(0);
  const [events, setEvents] = useState<ManagerAttendanceEvent[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [total, setTotal] = useState(0);
  const [members, setMembers] = useState<ManagedMember[]>([]);
  const [locations, setLocations] = useState<ManagerLocation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ManagerAttendanceEvent | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [faceUrl, setFaceUrl] = useState<string | null>(null);
  const [faceError, setFaceError] = useState<string | null>(null);
  const [logins, setLogins] = useState<LoginHistory | null>(null);
  const [adjustStatus, setAdjustStatus] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustNotice, setAdjustNotice] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (view !== "table") {
      return;
    }
    setSessions(null);
    try {
      const result = await api.managerAttendanceSessions({
        member_id: filters.member_id,
        location_id: filters.location_id,
        date_from: filters.date_from,
        date_to: filters.date_to,
        include_invalid: includeInvalid,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setSessions(result.items);
      setTotal(result.total);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
      setSessions([]);
    }
  }, [filters, page, view, includeInvalid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    Promise.all([api.managerMembers(), api.managerLocations()])
      .then(([memberRows, locationRows]) => {
        setMembers(memberRows);
        setLocations(locationRows);
      })
      .catch((cause) => setError(describeError(cause)));
  }, []);

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (faceUrl) {
        URL.revokeObjectURL(faceUrl);
      }
    };
  }, [faceUrl]);

  function updateFilter(patch: AttendanceFilters) {
    setPage(0);
    setFilters((current) => ({ ...current, ...patch }));
  }

  async function openPair(session: Session) {
    const id = session.check_in_id ?? session.check_out_id;
    if (!id) {
      return;
    }
    try {
      await openDetail(await api.managerAttendanceDetail(id));
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  async function openDetail(event: ManagerAttendanceEvent) {
    setSelected(event);
    setImageUrl(null);
    setImageError(null);
    setFaceUrl(null);
    setFaceError(null);
    setLogins(null);
    setAdjustStatus(event.status);
    setAdjustReason("");
    setAdjustError(null);
    setAdjustNotice(null);
    setDeleteReason("");
    if (event.has_image) {
      try {
        setImageUrl(await api.managerAttendanceImage(event.id));
      } catch (cause) {
        setImageError(describeError(cause));
      }
    }
    // The registered face and the face that turned up, so the comparison is a
    // person's judgement and not only a number the system produced.
    if (event.has_enrollment_photo) {
      try {
        setFaceUrl(await api.memberFacePhoto(event.member_id));
      } catch (cause) {
        setFaceError(describeError(cause));
      }
    }
    api
      .memberLoginHistory(event.member_id, 20)
      .then(setLogins)
      .catch(() => undefined);
  }

  async function removeRecord() {
    if (!selected) {
      return;
    }
    setDeleting(true);
    setAdjustError(null);
    try {
      await api.deleteAttendanceRecord(selected.id, deleteReason.trim());
      setSelected(null);
      setDeleteReason("");
      await load();
    } catch (cause) {
      setAdjustError(describeError(cause));
    } finally {
      setDeleting(false);
    }
  }

  async function submitAdjust() {
    if (!selected) {
      return;
    }
    setAdjusting(true);
    setAdjustError(null);
    setAdjustNotice(null);
    try {
      const updated = await api.manualAdjust(selected.id, { status: adjustStatus, reason: adjustReason.trim() });
      setSelected(updated);
      setAdjustNotice("Đã cập nhật trạng thái và lưu vào nhật ký hoạt động.");
      setAdjustReason("");
      await load();
    } catch (cause) {
      setAdjustError(describeError(cause));
    } finally {
      setAdjusting(false);
    }
  }

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <ManagerShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bản ghi</h1>
          <p className="page-lead">
            {view === "calendar"
              ? "Cả tháng trên một màn hình: ai đi làm ngày nào, ai muộn, ai chưa chấm ra."
              : "Toàn bộ lượt vào ra của những người bạn đang quản lý."}
          </p>
        </div>
        <div className="row">
          <div className="segmented" role="tablist" aria-label="Kiểu xem">
            <button
              type="button"
              role="tab"
              aria-selected={view === "calendar"}
              className={view === "calendar" ? "is-active" : undefined}
              onClick={() => setView("calendar")}
            >
              Lịch
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "table"}
              className={view === "table" ? "is-active" : undefined}
              onClick={() => setView("table")}
            >
              Bảng
            </button>
          </div>
          {view === "table" ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => exportToCsv(events ?? [])}
            disabled={!events || events.length === 0}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            }
          >
            Xuất CSV
          </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (view === "table" ? void load() : setRefreshToken((n) => n + 1))}
          >
            Làm mới
          </Button>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {view === "calendar" ? (
        <Card>
          <Field
            label="Tìm theo tên hoặc email"
            placeholder="Lọc nhanh những người hiện trên lịch"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeInvalid}
              onChange={(event) => setIncludeInvalid(event.target.checked)}
            />
            <span>Hiện cả lượt không hợp lệ</span>
          </label>
          <AttendanceCalendar search={search} refreshToken={refreshToken} includeInvalid={includeInvalid} />
        </Card>
      ) : null}

      {view === "table" ? (
      <>
      {/* Advanced Filter Card */}
      <Card title="Bộ lọc">
        <div className="filters-bar">
          <SelectField
            label="Trạng thái"
            value={filters.status ?? ""}
            onChange={(e) => updateFilter({ status: e.target.value ? (e.target.value as AttendanceStatus) : undefined })}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="SUCCESS">Hợp lệ</option>
            <option value="WARNING_CONFIRMED">Hợp lệ có lý do</option>
            <option value="BLOCKED">Ngoài phạm vi</option>
            <option value="FAILED">Không hợp lệ</option>
          </SelectField>

          <SelectField
            label="Thành viên"
            value={filters.member_id ?? ""}
            onChange={(e) => updateFilter({ member_id: e.target.value || undefined })}
          >
            <option value="">Tất cả thành viên</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name ? `${m.full_name} (${m.email})` : m.email}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Địa điểm"
            value={filters.location_id ?? ""}
            onChange={(e) => updateFilter({ location_id: e.target.value || undefined })}
          >
            <option value="">Tất cả địa điểm</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </SelectField>

          <Field
            label="Từ ngày"
            type="date"
            value={filters.date_from ?? ""}
            onChange={(e) => updateFilter({ date_from: e.target.value || undefined })}
          />

          <Field
            label="Đến ngày"
            type="date"
            value={filters.date_to ?? ""}
            onChange={(e) => updateFilter({ date_to: e.target.value || undefined })}
          />
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeInvalid}
            onChange={(event) => {
              setIncludeInvalid(event.target.checked);
              setPage(0);
            }}
          />
          <span>Hiện cả lượt không hợp lệ (ngoài phạm vi, khuôn mặt chưa khớp…)</span>
        </label>

        {Object.keys(filters).some((k) => (filters as Record<string, unknown>)[k] !== undefined) ? (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            Xoá bộ lọc
          </Button>
        ) : null}
      </Card>

      {/* One row per person per day: in, out, and what is missing */}
      <Card title={`Ngày công (${total})`}>
        {sessions === null ? (
          <LoadingRows count={5} />
        ) : sessions.length === 0 ? (
          <Empty>Không có ngày công nào khớp với bộ lọc hiện tại.</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table--grid">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Thành viên</th>
                    <th>Vào</th>
                    <th>Ra</th>
                    <th>Nơi</th>
                    <th>Tình trạng</th>
                    <th aria-label="Chi tiết" />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={`${session.member_id}-${session.work_date}`}>
                      <td data-label="Ngày">{session.work_date.split("-").reverse().join("/")}</td>
                      <td data-label="Thành viên">
                        <p className="person__name">{session.member_name ?? session.member_email}</p>
                      </td>
                      <td data-label="Vào" className="numeric">
                        {shortClock(session.check_in)}
                        {session.minutes_late > 0 ? (
                          <p className="event__meta" style={{ color: "var(--color-danger)" }}>
                            muộn {describeMinutes(session.minutes_late)}
                          </p>
                        ) : null}
                      </td>
                      <td data-label="Ra" className="numeric">
                        {session.check_out ? (
                          shortClock(session.check_out)
                        ) : (
                          <span style={{ color: "var(--color-warning)" }}>chưa ra</span>
                        )}
                        {session.minutes_early_leave > 0 ? (
                          <p className="event__meta">sớm {describeMinutes(session.minutes_early_leave)}</p>
                        ) : null}
                      </td>
                      <td data-label="Nơi">{session.location_name ?? "—"}</td>
                      <td data-label="Tình trạng">
                        <Badge tone={SESSION_TONE[session.status]}>
                          {SESSION_LABEL[session.status]}
                        </Badge>
                      </td>
                      <td data-label="Chi tiết">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void openPair(session)}
                          disabled={!session.check_in_id && !session.check_out_id}
                        >
                          Xem
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ← Trước
              </Button>
              <span className="mono">
                Trang {page + 1} / {lastPage + 1} · {total} ngày công
              </span>
              <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                Sau →
              </Button>
            </div>
          </>
        )}
      </Card>
      </>
      ) : null}

      {/* Side-by-Side Face Evidence & Adjustment Modal */}
      {selected ? (
        <Dialog title="Chi tiết lượt chấm công" onClose={() => setSelected(null)}>
          <div className="stack">
            {/* The registered face beside the face that turned up */}
            <div className="face-compare">
              <div className="face-compare__cell">
                <span className="face-compare__label">Ảnh đã đăng ký</span>
                <div className="face-compare__frame">
                  {faceUrl ? (
                    <img src={faceUrl} alt="Ảnh khuôn mặt đã đăng ký" />
                  ) : faceError ? (
                    <p className="face-compare__missing">{faceError}</p>
                  ) : selected.has_enrollment_photo ? (
                    <span className="spinner" />
                  ) : (
                    <p className="face-compare__missing">
                      Người này đăng ký khuôn mặt trước khi hệ thống lưu ảnh, nên không có ảnh gốc để đối chiếu.
                    </p>
                  )}
                </div>
              </div>
              <div className="face-compare__cell">
                <span className="face-compare__label">Ảnh lúc chấm công</span>
                <div className="face-compare__frame">
                  {imageUrl ? (
                    <img src={imageUrl} alt="Ảnh chụp lúc ghi nhận" />
                  ) : imageError ? (
                    <p className="face-compare__missing" style={{ color: "var(--color-danger)" }}>{imageError}</p>
                  ) : selected.has_image ? (
                    <span className="spinner" />
                  ) : (
                    <p className="face-compare__missing">Lượt này không có ảnh kèm theo.</p>
                  )}
                </div>
              </div>
            </div>

            {selected.face_match_score !== null || selected.face_distance !== null ? (
              <div className="face-metric">
                <div>
                  <p className="face-metric__label">Khoảng cách khuôn mặt</p>
                  <p className="face-metric__value">
                    {selected.face_distance !== null ? selected.face_distance.toFixed(3) : "—"}
                  </p>
                </div>
                <div>
                  <p className="face-metric__label">Độ tương đồng</p>
                  <p className="face-metric__value">
                    {selected.face_match_score !== null
                      ? `${(selected.face_match_score * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="face-metric__label">Thư viện nhận diện</p>
                  <p className="face-metric__value" style={{ fontSize: "var(--text-sm)" }}>
                    {selected.face_engine ?? "—"}
                  </p>
                </div>
              </div>
            ) : null}

            <DataList
              rows={[
                { key: "Thành viên", value: selected.member_name ? `${selected.member_name} (${selected.member_email})` : selected.member_email },
                { key: "Sự kiện", value: selected.event_type === "CHECK_IN" ? "Check-in" : "Check-out" },
                { key: "Địa điểm", value: selected.location_name },
                { key: "Thời điểm ghi nhận", value: formatDateTime(selected.server_time) },
                { key: "Cách địa điểm", value: `${selected.distance_meters.toFixed(1)} m (sai số định vị khoảng ${selected.gps_accuracy_meters.toFixed(0)} m)` },
                { key: "Trạng thái", value: <Badge tone={STATUS_TONE[selected.status]}>{STATUS_LABELS[selected.status] ?? selected.status}</Badge> },
                // Two different things were both called "lý do": why the system
                // refused, and what the member typed. They are separate rows now.
                ...(selected.failure_code
                  ? [
                      {
                        key: "Vì sao không hợp lệ",
                        value: (
                          <span style={{ color: "var(--color-danger)" }}>
                            {describeFailure(selected.failure_code)}
                          </span>
                        ),
                      },
                    ]
                  : []),
                ...(selected.minutes_late
                  ? [{ key: "Vào muộn", value: describeMinutes(selected.minutes_late) }]
                  : []),
                ...(selected.minutes_early_leave
                  ? [{ key: "Ra sớm", value: describeMinutes(selected.minutes_early_leave) }]
                  : []),
                { key: "Giải trình của thành viên", value: selected.reason ?? "Không có" },
                { key: "Lưu vào hệ thống lúc", value: formatDateTime(selected.created_at) },
                { key: "Mã bản ghi", value: <span className="mono">{selected.id}</span> },
                {
                  key: "Toạ độ ghi nhận",
                  value: (
                    <span className="mono">
                      {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}
                    </span>
                  ),
                },
              ]}
            />

            {logins && logins.items.length > 0 ? (
              <div>
                <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: "8px" }}>
                  Lần đăng nhập gần đây của người này
                </h3>
                <p className="event__meta" style={{ marginBottom: "8px" }}>
                  {LOGIN_SUMMARY(logins.totals)}
                </p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Thời điểm</th>
                        <th>Kết quả</th>
                        <th>Thiết bị</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logins.items.slice(0, 8).map((attempt, index) => (
                        <tr key={`${attempt.created_at}-${index}`}>
                          <td data-label="Thời điểm">{formatDateTime(attempt.created_at)}</td>
                          <td data-label="Kết quả">
                            <Badge tone={LOGIN_TONE[attempt.outcome] ?? "neutral"}>
                              {LOGIN_LABEL[attempt.outcome] ?? attempt.outcome}
                            </Badge>
                          </td>
                          <td data-label="Thiết bị">
                            <span className="event__meta">{shortDevice(attempt.user_agent)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* Manual Status Adjustment Box */}
            {may.edit ? (
            <div
              style={{
                background: "var(--surface-input)",
                padding: "var(--space-2)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <h3 style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: "8px" }}>
                Điều chỉnh trạng thái
              </h3>

              {adjustNotice ? <Alert tone="success">{adjustNotice}</Alert> : null}
              {adjustError ? <Alert tone="danger">{adjustError}</Alert> : null}

              <div className="stack stack--tight">
                <SelectField
                  label="Trạng thái mới"
                  value={adjustStatus}
                  onChange={(e) => setAdjustStatus(e.target.value)}
                >
                  <option value="SUCCESS">Hợp lệ</option>
                  <option value="WARNING_CONFIRMED">Hợp lệ có lý do</option>
                  <option value="FAILED">Không hợp lệ</option>
                  <option value="BLOCKED">Ngoài phạm vi</option>
                </SelectField>

                <TextAreaField
                  label="Lý do điều chỉnh (bắt buộc)"
                  required
                  placeholder="Nêu rõ căn cứ phê duyệt hoặc lý do sửa trạng thái…"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                />

                <Button
                  onClick={submitAdjust}
                  loading={adjusting}
                  disabled={adjustReason.trim().length === 0}
                  style={{ marginTop: "6px" }}
                  block
                >
                  Lưu thay đổi
                </Button>
              </div>
            </div>
            ) : null}

            {may.delete ? (
            <div className="danger-zone">
              <h3 className="danger-zone__title">Xoá bản ghi này</h3>
              <p className="danger-zone__text">
                Bản ghi sẽ biến khỏi bảng công của bạn và của thành viên. Việc xoá được ghi vào nhật ký kèm
                tên bạn và lý do, quản trị hệ thống vẫn khôi phục lại được.
              </p>
              <TextAreaField
                label="Lý do xoá (bắt buộc)"
                placeholder="Ví dụ: chấm nhầm ca, thành viên bấm hai lần…"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
              />
              <Button
                variant="danger"
                onClick={() => void removeRecord()}
                loading={deleting}
                disabled={deleteReason.trim().length < 3}
                block
              >
                Xoá bản ghi
              </Button>
            </div>
            ) : null}

          </div>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}

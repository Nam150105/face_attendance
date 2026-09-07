"use client";

import { useCallback, useEffect, useState } from "react";

import { Dialog } from "../../../components/Dialog";
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

export default function ManagerAttendancePage() {
  const [filters, setFilters] = useState<AttendanceFilters>({});
  const [page, setPage] = useState(0);
  const [events, setEvents] = useState<ManagerAttendanceEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [members, setMembers] = useState<ManagedMember[]>([]);
  const [locations, setLocations] = useState<ManagerLocation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ManagerAttendanceEvent | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [adjustStatus, setAdjustStatus] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustNotice, setAdjustNotice] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setEvents(null);
    try {
      const result = await api.managerAttendance({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      setEvents(result.items);
      setTotal(result.total);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
      setEvents([]);
    }
  }, [filters, page]);

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

  function updateFilter(patch: AttendanceFilters) {
    setPage(0);
    setFilters((current) => ({ ...current, ...patch }));
  }

  async function openDetail(event: ManagerAttendanceEvent) {
    setSelected(event);
    setImageUrl(null);
    setImageError(null);
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
          <p className="page-lead">Toàn bộ lượt vào ra của những người bạn đang quản lý.</p>
        </div>
        <div className="row">
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
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Làm mới
          </Button>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

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

        {Object.keys(filters).some((k) => (filters as Record<string, unknown>)[k] !== undefined) ? (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            Xoá bộ lọc
          </Button>
        ) : null}
      </Card>

      {/* Attendance Records Table */}
      <Card title={`Kết quả (${total} bản ghi)`}>
        {events === null ? (
          <LoadingRows count={5} />
        ) : events.length === 0 ? (
          <Empty>Không có bản ghi nào khớp với bộ lọc hiện tại.</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Thành viên</th>
                    <th>Sự kiện</th>
                    <th>Địa điểm</th>
                    <th>Thời điểm</th>
                    <th>Khoảng cách</th>
                    <th>Trạng thái</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td data-label="Thành viên">
                        <p className="person__name">{event.member_name ?? event.member_email}</p>
                        {event.member_name ? <p className="event__meta">{event.member_email}</p> : null}
                      </td>
                      <td data-label="Sự kiện">
                        <span style={{ fontWeight: 600, color: event.event_type === "CHECK_IN" ? "var(--color-primary)" : "var(--color-cyan)" }}>
                          {event.event_type === "CHECK_IN" ? "Check-in" : "Check-out"}
                        </span>
                      </td>
                      <td data-label="Địa điểm">{event.location_name}</td>
                      <td data-label="Thời điểm" className="numeric">
                        {formatDateTime(event.server_time)}
                      </td>
                      <td data-label="Khoảng cách" className="numeric">
                        {formatDistance(event.distance_meters)}
                      </td>
                      <td data-label="Trạng thái">
                        <Badge tone={STATUS_TONE[event.status]}>
                          {STATUS_LABELS[event.status] ?? event.status}
                        </Badge>
                        {event.failure_code ? (
                          <p className="event__meta" style={{ color: "var(--color-danger)" }}>
                            {describeFailure(event.failure_code)}
                          </p>
                        ) : null}
                      </td>
                      <td data-label="Chi tiết">
                        <Button size="sm" variant="secondary" onClick={() => void openDetail(event)}>
                          {event.has_image ? "Xem ảnh" : "Chi tiết"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="pagination">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ← Trước
              </Button>
              <span className="mono">
                Trang {page + 1} / {lastPage + 1} · {total} bản ghi
              </span>
              <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                Sau →
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* Side-by-Side Face Evidence & Adjustment Modal */}
      {selected ? (
        <Dialog title="Chi tiết lượt chấm công" onClose={() => setSelected(null)}>
          <div className="stack">
            {/* Image Preview Box */}
            {selected.has_image ? (
              <div className="evidence-box">
                <span className="evidence-box__label">Ảnh chụp lúc chấm công</span>
                <div className="evidence-img-wrap">
                  {imageUrl ? (
                    <img src={imageUrl} alt="Ảnh chụp lúc ghi nhận" className="evidence-img" />
                  ) : imageError ? (
                    <p style={{ color: "var(--color-danger)", padding: 16 }}>{imageError}</p>
                  ) : (
                    <span className="spinner" />
                  )}
                </div>
              </div>
            ) : (
              <Alert tone="info">Lượt này không có ảnh kèm theo.</Alert>
            )}

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
              ]}
            />

            {/* Manual Status Adjustment Box */}
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
          </div>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}

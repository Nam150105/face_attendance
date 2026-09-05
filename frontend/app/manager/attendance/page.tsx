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
import { describeError } from "../../../lib/messages";
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
  WARNING_CONFIRMED: "Cảnh báo",
  BLOCKED: "Bị chặn",
  FAILED: "Thất bại",
};

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
    if (event.has_image) {
      try {
        setImageUrl(await api.managerAttendanceImage(event.id));
      } catch (cause) {
        setImageError(describeError(cause));
      }
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
      setAdjustNotice("Đã lưu và ghi nhật ký.");
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
      <h1 className="page-title">Chấm công</h1>
      <p className="page-lead">Toàn bộ thành viên bạn quản lý, mới nhất trước.</p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card title="Bộ lọc">
        <div className="filters">
          <SelectField
            label="Thành viên"
            value={filters.member_id ?? ""}
            onChange={(event) => updateFilter({ member_id: event.target.value || undefined })}
          >
            <option value="">Tất cả</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.full_name ?? member.email}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Địa điểm"
            value={filters.location_id ?? ""}
            onChange={(event) => updateFilter({ location_id: event.target.value || undefined })}
          >
            <option value="">Tất cả</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Trạng thái"
            value={filters.status ?? ""}
            onChange={(event) => updateFilter({ status: (event.target.value || undefined) as AttendanceStatus })}
          >
            <option value="">Tất cả</option>
            <option value="SUCCESS">Hợp lệ</option>
            <option value="WARNING_CONFIRMED">Cảnh báo</option>
            <option value="BLOCKED">Bị chặn</option>
            <option value="FAILED">Thất bại</option>
          </SelectField>
          <SelectField
            label="Loại"
            value={filters.event_type ?? ""}
            onChange={(event) =>
              updateFilter({ event_type: (event.target.value || undefined) as "CHECK_IN" | "CHECK_OUT" })
            }
          >
            <option value="">Tất cả</option>
            <option value="CHECK_IN">Vào ca</option>
            <option value="CHECK_OUT">Ra ca</option>
          </SelectField>
          <Field
            label="Từ ngày"
            type="date"
            value={filters.date_from ?? ""}
            onChange={(event) => updateFilter({ date_from: event.target.value || undefined })}
          />
          <Field
            label="Đến ngày"
            type="date"
            value={filters.date_to ?? ""}
            onChange={(event) => updateFilter({ date_to: event.target.value || undefined })}
          />
        </div>
        <div className="row" style={{ marginTop: "var(--space-2)" }}>
          <Button
            variant="secondary"
            onClick={() => {
              setFilters({});
              setPage(0);
            }}
          >
            Xoá lọc
          </Button>
        </div>
      </Card>

      <Card title={`Kết quả (${total})`}>
        {events === null ? (
          <LoadingRows count={4} />
        ) : events.length === 0 ? (
          <Empty>Không có bản ghi khớp bộ lọc.</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Thành viên</th>
                    <th>Địa điểm</th>
                    <th>Vị trí</th>
                    <th>Khuôn mặt</th>
                    <th aria-label="Hành động" />
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td data-label="Thời gian" className="numeric">
                        <span className={`flow flow--${event.event_type === "CHECK_IN" ? "in" : "out"}`}>
                          {event.event_type === "CHECK_IN" ? "Vào" : "Ra"}
                        </span>{" "}
                        {formatDateTime(event.server_time)}
                      </td>
                      <td data-label="Thành viên">
                        <p className="event__label">{event.member_name ?? event.member_email}</p>
                        {event.reason ? <p className="event__meta">Lý do: {event.reason}</p> : null}
                      </td>
                      <td data-label="Địa điểm">{event.location_name}</td>
                      <td data-label="Vị trí" className="numeric">
                        <span
                          className={`meter meter--${
                            event.status === "SUCCESS" ? "ok" : event.status === "WARNING_CONFIRMED" ? "warn" : "bad"
                          }`}
                        >
                          {formatDistance(event.distance_meters)}
                        </span>
                        <p className="event__meta">±{event.gps_accuracy_meters.toFixed(0)} m</p>
                      </td>
                      <td data-label="Khuôn mặt" className="numeric">
                        {event.face_match_score !== null ? (
                          <>
                            <span className={`meter meter--${event.face_match_score >= 0.6 ? "ok" : "warn"}`}>
                              {(event.face_match_score * 100).toFixed(0)}%
                            </span>
                            <p className="event__meta">{event.face_match_score.toFixed(3)}</p>
                          </>
                        ) : (
                          <span className="event__meta">—</span>
                        )}
                      </td>
                      <td data-label="Hành động">
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          <Badge tone={STATUS_TONE[event.status]}>{STATUS_LABELS[event.status]}</Badge>
                          <Button variant="secondary" size="sm" onClick={() => void openDetail(event)}>
                            Chi tiết
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Trang trước
              </Button>
              <span>
                Trang {page + 1} / {lastPage + 1}
              </span>
              <Button variant="secondary" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                Trang sau
              </Button>
            </div>
          </>
        )}
      </Card>

      {selected ? (
        <Dialog title="Chi tiết chấm công" onClose={() => setSelected(null)}>
          <div className="stack">
            {selected.has_image ? (
              imageUrl ? (
                <img className="evidence" src={imageUrl} alt={`Ảnh bằng chứng của ${selected.member_email}`} />
              ) : imageError ? (
                <Alert tone="danger">{imageError}</Alert>
              ) : (
                <LoadingRows count={2} />
              )
            ) : (
              <Alert tone="warning">Không có ảnh bằng chứng.</Alert>
            )}

            <DataList
              rows={[
                { key: "Thành viên", value: selected.member_name ?? selected.member_email },
                { key: "Loại", value: selected.event_type === "CHECK_IN" ? "Check-in" : "Check-out" },
                { key: "Thời gian", value: formatDateTime(selected.server_time) },
                { key: "Địa điểm", value: selected.location_name },
                { key: "Khoảng cách", value: formatDistance(selected.distance_meters) },
                { key: "Sai số GPS", value: `${selected.gps_accuracy_meters.toFixed(0)} m` },
                {
                  key: "Toạ độ",
                  value: `${selected.latitude.toFixed(6)}, ${selected.longitude.toFixed(6)}`,
                },
                {
                  key: "Điểm khớp",
                  value: selected.face_match_score !== null ? selected.face_match_score.toFixed(4) : "—",
                },
                {
                  key: "Liveness",
                  value: selected.liveness_score !== null ? selected.liveness_score.toFixed(4) : "chưa có",
                },
                {
                  key: "Trạng thái",
                  value: <Badge tone={STATUS_TONE[selected.status]}>{STATUS_LABELS[selected.status]}</Badge>,
                },
                { key: "Lý do", value: selected.reason ?? "—" },
              ]}
            />

            <hr style={{ border: "none", borderTop: "1px solid var(--border-subtle)", margin: 0 }} />

            <h3 className="card__title" style={{ fontSize: "var(--text-md)" }}>
              Điều chỉnh
            </h3>
            <SelectField
              label="Trạng thái mới"
              value={adjustStatus}
              onChange={(event) => setAdjustStatus(event.target.value)}
            >
              <option value="SUCCESS">SUCCESS</option>
              <option value="WARNING_CONFIRMED">WARNING_CONFIRMED</option>
              <option value="BLOCKED">BLOCKED</option>
              <option value="FAILED">FAILED</option>
            </SelectField>
            <TextAreaField
              label="Lý do điều chỉnh"
              hint="Bắt buộc, tối thiểu 3 ký tự. Lưu vào nhật ký."
              required
              maxLength={500}
              value={adjustReason}
              onChange={(event) => setAdjustReason(event.target.value)}
            />
            {adjustError ? <Alert tone="danger">{adjustError}</Alert> : null}
            {adjustNotice ? <Alert tone="success">{adjustNotice}</Alert> : null}
            <Button
              onClick={() => void submitAdjust()}
              loading={adjusting}
              disabled={adjustReason.trim().length < 3 || adjustStatus === selected.status}
            >
              Lưu
            </Button>
          </div>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}

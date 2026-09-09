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
import { formatDateTime } from "../../../lib/geo";
import { describeError, describeFailure } from "../../../lib/messages";
import { describeMinutes } from "../../../lib/member";
import type { AttendanceStatus, ManagerAttendanceEvent } from "../../../lib/types";

/** A day of one manager's people fits on one screen; there is nothing to page. */
const DAY_LIMIT = 200;

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

function exportSessions(day: string, sessions: Session[]) {
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
    SESSION_LABEL[session.status],
  ]);
  // The BOM is what makes Excel read Vietnamese instead of mojibake.
  const csv =
    "﻿" +
    [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `cham-cong-${day}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

/** Time between arriving and leaving; nothing yet if the day is still open. */
function presenceOf(session: Session): string {
  if (!session.check_in || !session.check_out) {
    return "Chưa chấm ra";
  }
  const minutes = Math.round(
    (new Date(session.check_out).getTime() - new Date(session.check_in).getTime()) / 60000,
  );
  return minutes > 0 ? describeMinutes(minutes) : "0 phút";
}

function clockOf(value: string | null): string {
  return value
    ? new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
    : "—";
}

function shortClock(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export default function ManagerAttendancePage() {
  const may = usePermissions("records");
  const [search, setSearch] = useState("");
  // Refused attempts are not attendance; they are shown only when asked for.
  const [includeInvalid, setIncludeInvalid] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  // One calendar. A day is a thing you click, not a second view of the same
  // data behind a tab — the month tells you where to look, the day tells you
  // what happened there.
  const [day, setDay] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ManagerAttendanceEvent | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [faceUrl, setFaceUrl] = useState<string | null>(null);
  const [faceError, setFaceError] = useState<string | null>(null);
  const [pairFor, setPairFor] = useState<Session | null>(null);
  const [exitUrl, setExitUrl] = useState<string | null>(null);
  const [adjustStatus, setAdjustStatus] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustNotice, setAdjustNotice] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!day) {
      return;
    }
    setSessions(null);
    try {
      const result = await api.managerAttendanceSessions({
        date_from: day,
        date_to: day,
        include_invalid: includeInvalid,
        limit: DAY_LIMIT,
        offset: 0,
      });
      setSessions(result.items);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
      setSessions([]);
    }
  }, [day, includeInvalid]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function openPair(session: Session) {
    const id = session.check_in_id ?? session.check_out_id;
    if (!id) {
      return;
    }
    setPairFor(session);
    try {
      await openDetail(await api.managerAttendanceDetail(id));
      // The photo taken on the way out is the other half of the evidence.
      // Showing only the arrival meant half of every question went unanswered.
      setExitUrl(null);
      if (session.check_out_id && session.check_out_id !== id) {
        setExitUrl(await api.managerAttendanceImage(session.check_out_id).catch(() => null));
      }
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

  const dayLabel = day ? day.split("-").reverse().join("/") : "";
  const needle = search.trim().toLowerCase();
  const shownSessions = (sessions ?? []).filter(
    (session) =>
      !needle ||
      (session.member_name ?? "").toLowerCase().includes(needle) ||
      session.member_email.toLowerCase().includes(needle),
  );

  return (
    <ManagerShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bản ghi</h1>
          <p className="page-lead">
            Cả tháng trên một màn hình. Bấm vào một ngày để xem ai vào ra ngày đó.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => {
          setRefreshToken((n) => n + 1);
          void load();
        }}>
          Làm mới
        </Button>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card>
        <div className="filter-row">
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
        </div>
        <AttendanceCalendar
          search={search}
          refreshToken={refreshToken}
          includeInvalid={includeInvalid}
          selectedDate={day}
          onPickDay={(picked) => setDay((current) => (current === picked ? null : picked))}
        />
      </Card>

      {day ? (
        <Card
          title={`Ngày ${dayLabel}`}
          subtitle={sessions ? `${shownSessions.length} ngày công` : undefined}
          action={
            <div className="row">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => exportSessions(day, shownSessions)}
                disabled={shownSessions.length === 0}
              >
                Xuất CSV
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDay(null)}>
                Đóng
              </Button>
            </div>
          }
        >
          {sessions === null ? (
            <LoadingRows count={4} />
          ) : shownSessions.length === 0 ? (
            <Empty>Không ai chấm công ngày này.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table table--grid">
                <thead>
                  <tr>
                    <th>Thành viên</th>
                    <th>Vào</th>
                    <th>Ra</th>
                    <th>Có mặt</th>
                    <th>Nơi</th>
                    <th>Tình trạng</th>
                    <th aria-label="Chi tiết" />
                  </tr>
                </thead>
                <tbody>
                  {shownSessions.map((session) => (
                    <tr key={`${session.member_id}-${session.work_date}`}>
                      <td data-label="Thành viên">
                        <p className="person__name">{session.member_name ?? session.member_email}</p>
                        <p className="event__meta">{session.member_email}</p>
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
                      <td data-label="Có mặt" className="numeric">
                        {presenceOf(session)}
                      </td>
                      <td data-label="Nơi">{session.location_name ?? "—"}</td>
                      <td data-label="Tình trạng">
                        <Badge tone={SESSION_TONE[session.status]}>{SESSION_LABEL[session.status]}</Badge>
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
          )}
        </Card>
      ) : null}

      {/* Side-by-Side Face Evidence & Adjustment Modal */}
      {selected ? (
        <Dialog title="Chi tiết lượt chấm công" onClose={() => {
            setSelected(null);
            setPairFor(null);
            setExitUrl(null);
          }}>
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
                <span className="face-compare__label">Ảnh lúc vào</span>
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

              {pairFor?.check_out_id ? (
                <div className="face-compare__cell">
                  <span className="face-compare__label">Ảnh lúc ra</span>
                  <div className="face-compare__frame">
                    {exitUrl ? (
                      <img src={exitUrl} alt="Ảnh chụp lúc chấm ra" />
                    ) : (
                      <p className="face-compare__missing">Lượt ra không có ảnh kèm theo.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {pairFor ? (
              <div className="face-metric">
                <div>
                  <p className="face-metric__label">Giờ vào</p>
                  <p className="face-metric__value">{clockOf(pairFor.check_in)}</p>
                </div>
                <div>
                  <p className="face-metric__label">Giờ ra</p>
                  <p className="face-metric__value">{clockOf(pairFor.check_out)}</p>
                </div>
                <div>
                  <p className="face-metric__label">Tổng thời gian có mặt</p>
                  <p className="face-metric__value">{presenceOf(pairFor)}</p>
                </div>
              </div>
            ) : null}

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

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
import type { AttendanceStatus, ManagerAttendanceEvent, ManagerLocation } from "../../../lib/types";

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

/** A verdict is the machine's until somebody overrules it. */
type Verdict = "machine" | "yes" | "no";

function verdictOf(value: boolean | null | undefined): Verdict {
  return value === null || value === undefined ? "machine" : value ? "yes" : "no";
}

function verdictValue(verdict: Verdict): boolean | null {
  return verdict === "machine" ? null : verdict === "yes";
}

/** A timestamp in the shape <input type="datetime-local"> wants, in local time. */
function toLocalInput(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
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
  const [faceUrl, setFaceUrl] = useState<string | null>(null);
  const [faceError, setFaceError] = useState<string | null>(null);
  const [pairFor, setPairFor] = useState<Session | null>(null);
  // The two evidence photos belong to the day, not to whichever half is being
  // edited, so they are fetched once and stay put while the form switches.
  const [entryUrl, setEntryUrl] = useState<string | null>(null);
  const [exitUrl, setExitUrl] = useState<string | null>(null);
  const [half, setHalf] = useState<"in" | "out">("in");
  const [locations, setLocations] = useState<ManagerLocation[]>([]);

  // The edit form. Every field starts at what the record currently says, so
  // saving without touching anything changes nothing.
  const [editStatus, setEditStatus] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editFace, setEditFace] = useState<Verdict>("machine");
  const [editPlace, setEditPlace] = useState<Verdict>("machine");
  const [editNote, setEditNote] = useState("");
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
      if (entryUrl) {
        URL.revokeObjectURL(entryUrl);
      }
    };
  }, [entryUrl]);

  useEffect(() => {
    return () => {
      if (exitUrl) {
        URL.revokeObjectURL(exitUrl);
      }
    };
  }, [exitUrl]);

  useEffect(() => {
    return () => {
      if (faceUrl) {
        URL.revokeObjectURL(faceUrl);
      }
    };
  }, [faceUrl]);

  async function openPair(session: Session) {
    const first = session.check_in_id ? "in" : "out";
    const id = session.check_in_id ?? session.check_out_id;
    if (!id) {
      return;
    }
    setPairFor(session);
    setHalf(first);
    setEntryUrl(null);
    setExitUrl(null);
    setFaceUrl(null);
    setFaceError(null);
    setDeleteReason("");
    try {
      const event = await api.managerAttendanceDetail(id);
      loadForm(event);
      // Both photos, once. Whichever half is being corrected, the manager is
      // looking at the same pair of faces.
      if (session.check_in_id) {
        setEntryUrl(await api.managerAttendanceImage(session.check_in_id).catch(() => null));
      }
      if (session.check_out_id) {
        setExitUrl(await api.managerAttendanceImage(session.check_out_id).catch(() => null));
      }
      if (event.has_enrollment_photo) {
        setFaceUrl(await api.memberFacePhoto(event.member_id).catch(() => null));
      }
      if (locations.length === 0) {
        setLocations(await api.managerLocations().catch(() => []));
      }
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  /** Point the form at one half of the day. */
  async function switchHalf(next: "in" | "out") {
    const id = next === "in" ? pairFor?.check_in_id : pairFor?.check_out_id;
    if (!id || next === half) {
      return;
    }
    setHalf(next);
    try {
      loadForm(await api.managerAttendanceDetail(id));
    } catch (cause) {
      setAdjustError(describeError(cause));
    }
  }

  function loadForm(event: ManagerAttendanceEvent) {
    setSelected(event);
    setEditStatus(event.status);
    setEditTime(toLocalInput(event.server_time));
    setEditLocation(event.location_id);
    setEditFace(verdictOf(event.face_verdict_override));
    setEditPlace(verdictOf(event.location_verdict_override));
    setEditNote(event.reason ?? "");
    setAdjustReason("");
    setAdjustError(null);
    setAdjustNotice(null);
  }

  async function removeRecord() {
    if (!selected) {
      return;
    }
    setDeleting(true);
    setAdjustError(null);
    try {
      // The row this dialog was opened from is a working day, so that is what
      // gets deleted: arrival, departure, and anything refused in between.
      // Deleting one event used to leave the other half behind, and the day
      // came back looking like a record nobody made.
      if (pairFor) {
        await api.deleteAttendanceDay(pairFor.member_id, pairFor.work_date, deleteReason.trim());
      } else {
        await api.deleteAttendanceRecord(selected.id, deleteReason.trim());
      }
      setSelected(null);
      setPairFor(null);
      setExitUrl(null);
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
      const updated = await api.manualAdjust(selected.id, {
        status: editStatus,
        server_time: new Date(editTime).toISOString(),
        location_id: editLocation,
        face_ok: verdictValue(editFace),
        location_ok: verdictValue(editPlace),
        note: editNote.trim(),
        reason: adjustReason.trim(),
      });
      loadForm(updated);
      setAdjustNotice("Đã lưu và ghi vào nhật ký hoạt động.");
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
            <div className="stack stack--tight">
              {shownSessions.map((session) => (
                <button
                  type="button"
                  className="day-line"
                  key={`${session.member_id}-${session.work_date}`}
                  onClick={() => void openPair(session)}
                  disabled={!session.check_in_id && !session.check_out_id}
                >
                  <span className="day-line__who">
                    <span className="person__name">{session.member_name ?? session.member_email}</span>
                    <span className="event__meta">
                      {shortClock(session.check_in)} → {session.check_out ? shortClock(session.check_out) : "chưa ra"}
                      {session.check_out ? ` · ${presenceOf(session)}` : ""}
                      {session.location_name ? ` · ${session.location_name}` : ""}
                    </span>
                  </span>
                  <Badge tone={SESSION_TONE[session.status]}>{SESSION_LABEL[session.status]}</Badge>
                </button>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {/* One day's evidence, and the form that corrects it */}
      {selected && pairFor ? (
        <Dialog
          title="Chi tiết lượt chấm công"
          onClose={() => {
            setSelected(null);
            setPairFor(null);
            setEntryUrl(null);
            setExitUrl(null);
          }}
        >
          <div className="stack">
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
                    <p className="face-compare__missing">Không có ảnh gốc để đối chiếu.</p>
                  )}
                </div>
              </div>
              {pairFor.check_in_id ? (
                <div className="face-compare__cell">
                  <span className="face-compare__label">Ảnh lúc vào</span>
                  <div className="face-compare__frame">
                    {entryUrl ? (
                      <img src={entryUrl} alt="Ảnh chụp lúc chấm vào" />
                    ) : (
                      <p className="face-compare__missing">Lượt vào không có ảnh kèm theo.</p>
                    )}
                  </div>
                </div>
              ) : null}
              {pairFor.check_out_id ? (
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

            <div className="face-metric">
              <div>
                <p className="face-metric__label">Vào</p>
                <p className="face-metric__value">{clockOf(pairFor.check_in)}</p>
              </div>
              <div>
                <p className="face-metric__label">Ra</p>
                <p className="face-metric__value">{clockOf(pairFor.check_out)}</p>
              </div>
              <div>
                <p className="face-metric__label">Có mặt</p>
                <p className="face-metric__value">{presenceOf(pairFor)}</p>
              </div>
              {selected.face_distance !== null || selected.face_match_score !== null ? (
                <div>
                  <p className="face-metric__label">Khuôn mặt</p>
                  <p className="face-metric__value">
                    {selected.face_distance !== null ? selected.face_distance.toFixed(3) : "—"}
                    {selected.face_match_score !== null
                      ? ` · ${(selected.face_match_score * 100).toFixed(0)}%`
                      : ""}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Which half of the day is on the form. A day is two records, and
                correcting one of them should not mean opening a second screen. */}
            {pairFor.check_in_id && pairFor.check_out_id ? (
              <div className="segmented" role="tablist" aria-label="Lượt cần xem">
                <button
                  type="button"
                  role="tab"
                  aria-selected={half === "in"}
                  className={half === "in" ? "is-active" : undefined}
                  onClick={() => void switchHalf("in")}
                >
                  Lượt vào
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={half === "out"}
                  className={half === "out" ? "is-active" : undefined}
                  onClick={() => void switchHalf("out")}
                >
                  Lượt ra
                </button>
              </div>
            ) : null}

            <DataList
              rows={[
                { key: "Thành viên", value: selected.member_name ?? selected.member_email },
                { key: "Địa điểm", value: selected.location_name },
                {
                  key: "Trạng thái",
                  value: (
                    <Badge tone={STATUS_TONE[selected.status]}>
                      {STATUS_LABELS[selected.status] ?? selected.status}
                    </Badge>
                  ),
                },
                { key: "Cách địa điểm", value: `${selected.distance_meters.toFixed(1)} m` },
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
                ...(selected.reason
                  ? [{ key: "Giải trình của thành viên", value: selected.reason }]
                  : []),
                ...(selected.edited_at
                  ? [
                      {
                        key: "Đã được sửa",
                        value: `${formatDateTime(selected.edited_at)}${
                          selected.edited_by_email ? ` · ${selected.edited_by_email}` : ""
                        }${selected.edit_reason ? ` · ${selected.edit_reason}` : ""}`,
                      },
                    ]
                  : []),
              ]}
            />

            <details className="disclosure">
              <summary>Thông tin kỹ thuật</summary>
              <DataList
                rows={[
                  { key: "Sự kiện", value: selected.event_type === "CHECK_IN" ? "Check-in" : "Check-out" },
                  { key: "Thời điểm ghi nhận", value: formatDateTime(selected.server_time) },
                  ...(selected.original_server_time
                    ? [
                        {
                          key: "Thiết bị báo lúc đầu",
                          value: formatDateTime(selected.original_server_time),
                        },
                      ]
                    : []),
                  { key: "Lưu vào hệ thống lúc", value: formatDateTime(selected.created_at) },
                  { key: "Sai số định vị", value: `${selected.gps_accuracy_meters.toFixed(0)} m` },
                  {
                    key: "Toạ độ ghi nhận",
                    value: (
                      <span className="mono">
                        {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}
                      </span>
                    ),
                  },
                  { key: "Thư viện nhận diện", value: selected.face_engine ?? "—" },
                  { key: "Mã bản ghi", value: <span className="mono">{selected.id}</span> },
                ]}
              />
            </details>

            {may.edit ? (
              <div className="edit-box">
                <h3 className="subhead">
                  Sửa {selected.event_type === "CHECK_IN" ? "lượt vào" : "lượt ra"}
                </h3>

                {adjustNotice ? <Alert tone="success">{adjustNotice}</Alert> : null}
                {adjustError ? <Alert tone="danger">{adjustError}</Alert> : null}

                <div className="stack stack--tight">
                  <div className="filter-row">
                    <Field
                      label="Thời điểm"
                      type="datetime-local"
                      value={editTime}
                      onChange={(event) => setEditTime(event.target.value)}
                    />
                    <SelectField
                      label="Địa điểm"
                      value={editLocation}
                      onChange={(event) => setEditLocation(event.target.value)}
                    >
                      {locations.some((row) => row.id === editLocation) ? null : (
                        <option value={editLocation}>{selected.location_name}</option>
                      )}
                      {locations.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </SelectField>
                  </div>

                  {/* The machine measured; a person may disagree. Both answers
                      are kept — the score is never rewritten. */}
                  <div className="verdicts">
                    <div className="verdict">
                      <span className="field__label">Vị trí</span>
                      <div className="segmented segmented--sm">
                        {(["machine", "yes", "no"] as Verdict[]).map((value) => (
                          <button
                            type="button"
                            key={value}
                            className={editPlace === value ? "is-active" : undefined}
                            aria-pressed={editPlace === value}
                            onClick={() => setEditPlace(value)}
                          >
                            {value === "machine" ? "Theo máy đo" : value === "yes" ? "Hợp lệ" : "Không hợp lệ"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="verdict">
                      <span className="field__label">Khuôn mặt</span>
                      <div className="segmented segmented--sm">
                        {(["machine", "yes", "no"] as Verdict[]).map((value) => (
                          <button
                            type="button"
                            key={value}
                            className={editFace === value ? "is-active" : undefined}
                            aria-pressed={editFace === value}
                            onClick={() => setEditFace(value)}
                          >
                            {value === "machine" ? "Theo máy đo" : value === "yes" ? "Khớp" : "Không khớp"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <SelectField
                    label="Trạng thái bản ghi"
                    value={editStatus}
                    onChange={(event) => setEditStatus(event.target.value)}
                  >
                    <option value="SUCCESS">Hợp lệ</option>
                    <option value="WARNING_CONFIRMED">Hợp lệ có lý do</option>
                    <option value="FAILED">Không hợp lệ</option>
                    <option value="BLOCKED">Ngoài phạm vi</option>
                  </SelectField>

                  <Field
                    label="Giải trình của thành viên"
                    placeholder="Ghi lại lời của thành viên nếu có"
                    value={editNote}
                    onChange={(event) => setEditNote(event.target.value)}
                  />

                  <TextAreaField
                    label="Lý do sửa (bắt buộc)"
                    required
                    placeholder="Ví dụ: đồng hồ máy lệch 15 phút, đã đối chiếu camera cửa."
                    value={adjustReason}
                    onChange={(event) => setAdjustReason(event.target.value)}
                  />

                  <Button
                    onClick={() => void submitAdjust()}
                    loading={adjusting}
                    disabled={adjustReason.trim().length < 3}
                    block
                  >
                    Lưu thay đổi
                  </Button>
                </div>
              </div>
            ) : null}

            {may.delete ? (
              <div className="danger-zone">
                <h3 className="danger-zone__title">Xoá cả ngày công này</h3>
                <p className="danger-zone__text">
                  Xoá hết lượt vào, lượt ra và cả những lần bị từ chối trong ngày này. Việc xoá được
                  ghi vào nhật ký kèm tên bạn và lý do, quản trị hệ thống vẫn khôi phục lại được.
                </p>
                <TextAreaField
                  label="Lý do xoá (bắt buộc)"
                  placeholder="Ví dụ: chấm nhầm ca, thành viên bấm hai lần…"
                  value={deleteReason}
                  onChange={(event) => setDeleteReason(event.target.value)}
                />
                <Button
                  variant="danger"
                  onClick={() => void removeRecord()}
                  loading={deleting}
                  disabled={deleteReason.trim().length < 3}
                  block
                >
                  Xoá cả ngày công
                </Button>
              </div>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </ManagerShell>
  );
}

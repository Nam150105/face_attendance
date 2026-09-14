"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/geo";
import { describeMinutes } from "../../lib/member";
import { describeError, describeFailure } from "../../lib/messages";
import { DAY_STATUS, EVENT_STATUS, SOURCE_LABEL, clock, initials, longDate, presenceOf, timingPill } from "../../lib/records";
import type { DaySession, ManagerAttendanceEvent, ManagerLocation } from "../../lib/types";
import { GeoMap, type MapCircle, type MapMarker } from "../GeoMap";
import { RefusedAttempts } from "./RefusedAttempts";
import { Alert, Badge, Button, DataList, Field, SelectField, TextAreaField } from "../ui";

/**
 * The verdict of a record, as one choice.
 *
 * One list, four answers, and the record says the same thing everywhere: the
 * badge on the row, the pill in the drawer, the option in this dropdown.
 */
type Verdict = "VALID" | "EXCUSED" | "FACE" | "PLACE";

const VERDICTS: { key: Verdict; status: string; failure: string | null; label: string }[] = [
  { key: "VALID", status: "SUCCESS", failure: null, label: "Hợp lệ" },
  { key: "EXCUSED", status: "WARNING_CONFIRMED", failure: null, label: "Hợp lệ có lý do" },
  { key: "FACE", status: "FAILED", failure: "FACE_NOT_MATCHED", label: "Khuôn mặt không khớp" },
  { key: "PLACE", status: "BLOCKED", failure: "OUTSIDE_ALLOWED_ZONE", label: "Địa điểm không khớp" },
];

function verdictOf(event: ManagerAttendanceEvent): Verdict {
  if (event.status === "SUCCESS") return "VALID";
  if (event.status === "WARNING_CONFIRMED") return "EXCUSED";
  return event.status === "BLOCKED" ? "PLACE" : "FACE";
}

/** A timestamp in the shape <input type="datetime-local"> wants, in local time. */
function toLocalInput(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function PersonPanel({
  session,
  attemptId,
  locations,
  canEdit,
  canDelete,
  isAdmin,
  onChanged,
  onDeleted,
}: {
  session: DaySession;
  /** A refused attempt to open instead of the day's valid pair. */
  attemptId?: string | null;
  locations: ManagerLocation[];
  canEdit: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<ManagerAttendanceEvent | null>(null);
  const [half, setHalf] = useState<"in" | "out">("in");
  const [faceUrl, setFaceUrl] = useState<string | null>(null);
  const [entryUrl, setEntryUrl] = useState<string | null>(null);
  const [exitUrl, setExitUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The check-in and the check-out, both fetched so the map can show where the
  // person stood at each end of the day.
  const [entryEvent, setEntryEvent] = useState<ManagerAttendanceEvent | null>(null);
  const [exitEvent, setExitEvent] = useState<ManagerAttendanceEvent | null>(null);

  const [editTime, setEditTime] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editVerdict, setEditVerdict] = useState<Verdict>("VALID");
  const [editNote, setEditNote] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustNotice, setAdjustNotice] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  function loadForm(event: ManagerAttendanceEvent) {
    setSelected(event);
    setEditVerdict(verdictOf(event));
    setEditTime(toLocalInput(event.server_time));
    setEditLocation(event.location_id);
    setEditNote(event.reason ?? "");
    setAdjustReason("");
    setAdjustError(null);
    setAdjustNotice(null);
  }

  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    setSelected(null);
    setEntryEvent(null);
    setExitEvent(null);
    setFaceUrl(null);
    setEntryUrl(null);
    setExitUrl(null);
    setLoadError(null);
    setShowEdit(false);
    setDeleteReason("");
    void (async () => {
      try {
        const firstId = attemptId ?? session.check_in_id ?? session.check_out_id;
        if (!firstId) {
          return;
        }
        const first = await api.managerAttendanceDetail(firstId);
        if (!live) return;
        loadForm(first);
        setHalf(attemptId ? "in" : session.check_in_id ? "in" : "out");
        if (attemptId) {
          setEntryEvent(first);
          if (first.has_image) {
            const url = await api.managerAttendanceImage(attemptId).catch(() => null);
            if (url) urls.push(url);
            if (live) setEntryUrl(url);
          }
        } else {
          if (session.check_in_id) {
            setEntryEvent(first.event_type === "CHECK_IN" ? first : await api.managerAttendanceDetail(session.check_in_id));
            const url = await api.managerAttendanceImage(session.check_in_id).catch(() => null);
            if (url) urls.push(url);
            if (live) setEntryUrl(url);
          }
          if (session.check_out_id) {
            const exit = first.event_type === "CHECK_OUT" ? first : await api.managerAttendanceDetail(session.check_out_id);
            if (live) setExitEvent(exit);
            const url = await api.managerAttendanceImage(session.check_out_id).catch(() => null);
            if (url) urls.push(url);
            if (live) setExitUrl(url);
          }
        }
        if (first.has_enrollment_photo) {
          const url = await api.memberFacePhoto(first.member_id).catch(() => null);
          if (url) urls.push(url);
          if (live) setFaceUrl(url);
        }
      } catch (cause) {
        if (live) setLoadError(describeError(cause));
      }
    })();
    return () => {
      live = false;
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.member_id, session.work_date, session.check_in_id, session.check_out_id, attemptId]);

  async function switchHalf(next: "in" | "out") {
    const id = next === "in" ? session.check_in_id : session.check_out_id;
    if (!id || next === half) {
      return;
    }
    setHalf(next);
    const known = next === "in" ? entryEvent : exitEvent;
    if (known) {
      loadForm(known);
      return;
    }
    try {
      loadForm(await api.managerAttendanceDetail(id));
    } catch (cause) {
      setAdjustError(describeError(cause));
    }
  }

  async function submitAdjust() {
    if (!selected) return;
    setAdjusting(true);
    setAdjustError(null);
    setAdjustNotice(null);
    try {
      const chosen = VERDICTS.find((item) => item.key === editVerdict)!;
      const updated = await api.manualAdjust(selected.id, {
        status: chosen.status,
        // Only when the verdict itself changed: a record refused for
        // FACE_NOT_FOUND keeps that reason instead of being rewritten to the
        // nearest of the four choices.
        ...(editVerdict === verdictOf(selected) || chosen.failure === null ? {} : { failure_code: chosen.failure }),
        server_time: new Date(editTime).toISOString(),
        location_id: editLocation,
        note: editNote.trim(),
        reason: adjustReason.trim(),
      });
      loadForm(updated);
      if (updated.event_type === "CHECK_IN") setEntryEvent(updated);
      else setExitEvent(updated);
      setAdjustNotice("Đã lưu và ghi vào nhật ký hoạt động.");
      await onChanged();
    } catch (cause) {
      setAdjustError(describeError(cause));
    } finally {
      setAdjusting(false);
    }
  }

  async function removeDay() {
    setDeleting(true);
    setAdjustError(null);
    try {
      // The whole working day goes: arrival, departure, and anything refused
      // in between. Deleting one half used to leave a record nobody made.
      await api.deleteAttendanceDay(session.member_id, session.work_date, deleteReason.trim());
      await onDeleted();
    } catch (cause) {
      setAdjustError(describeError(cause));
    } finally {
      setDeleting(false);
    }
  }

  // Where they stood, on the workplace's own map. A location outside this
  // manager's list (a member checked in at another manager's site) is drawn
  // as pins only.
  const site = locations.find((row) => row.id === (entryEvent?.location_id ?? selected?.location_id));
  const circles = useMemo<MapCircle[]>(
    () =>
      site
        ? [
            { center: { latitude: site.latitude, longitude: site.longitude }, radiusMeters: site.warning_radius_meters, color: "#b45309", dashed: true },
            { center: { latitude: site.latitude, longitude: site.longitude }, radiusMeters: site.allow_radius_meters, color: "#0e7a55" },
          ]
        : [],
    [site],
  );
  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    if (site) list.push({ point: { latitude: site.latitude, longitude: site.longitude }, kind: "site", label: site.name });
    if (entryEvent?.latitude !== null && entryEvent?.latitude !== undefined && entryEvent.longitude !== null) {
      list.push({ point: { latitude: entryEvent.latitude, longitude: entryEvent.longitude }, kind: "in", label: `Chấm vào ${clock(entryEvent.server_time)}` });
    }
    if (exitEvent?.latitude !== null && exitEvent?.latitude !== undefined && exitEvent.longitude !== null) {
      list.push({ point: { latitude: exitEvent.latitude, longitude: exitEvent.longitude }, kind: "out", label: `Chấm ra ${clock(exitEvent.server_time)}` });
    }
    return list;
  }, [site, entryEvent, exitEvent]);

  const pill = session.check_in
    ? timingPill(session)
    : { label: DAY_STATUS[session.status].label, tone: DAY_STATUS[session.status].tone };

  return (
    <div className="stack">
      {loadError ? <Alert tone="danger">{loadError}</Alert> : null}

      {/* The day at a glance: the two times, and the gap between them. */}
      <section className="day-card">
        <div className="day-card__top">
          <span className="day-card__date">{longDate(session.work_date)}</span>
          <Badge tone={pill.tone}>{pill.label}</Badge>
        </div>
        {!session.check_in && !attemptId ? (
          <p className="day-card__none">
            Không có lượt hợp lệ trong ngày — {session.rejected} lần thử bị từ chối, xem bên dưới.
          </p>
        ) : (
        <div className="day-card__times">
          <div>
            <span className="day-card__label">Vào</span>
            <span className="day-card__time mono">{clock(session.check_in)}</span>
          </div>
          <span className="day-card__rule" aria-hidden="true">
            {session.check_in && session.check_out ? presenceOf(session) : ""}
          </span>
          <div className="is-right">
            <span className="day-card__label">Ra</span>
            <span className={`day-card__time mono${session.check_out ? "" : " is-open"}`}>
              {session.check_out ? clock(session.check_out) : "Chưa ra ca"}
            </span>
          </div>
        </div>
        )}
        {session.location_name ? <p className="day-card__place">{session.location_name}</p> : null}
      </section>

      {/* Three faces: the one on file, the one at the door, the one leaving. */}
      <section>
        <h3 className="drawer__section">Khuôn mặt</h3>
        <div className="face-compare">
          <div className="face-compare__cell">
            <span className="face-compare__label">Đã đăng ký</span>
            <div className="face-compare__frame">
              {faceUrl ? (
                <img src={faceUrl} alt="Ảnh khuôn mặt đã đăng ký" />
              ) : selected?.has_enrollment_photo ? (
                <span className="spinner" />
              ) : (
                <p className="face-compare__missing">Không có ảnh gốc.</p>
              )}
            </div>
          </div>
          {session.check_in_id || attemptId ? (
          <div className="face-compare__cell">
            <span className="face-compare__label">{attemptId ? "Lúc thử" : "Lúc vào"}</span>
            <div className="face-compare__frame">
              {entryUrl ? (
                <img src={entryUrl} alt="Ảnh chụp lúc chấm vào" />
              ) : (
                <p className="face-compare__missing">Không có ảnh kèm.</p>
              )}
            </div>
          </div>
          ) : null}
          {!attemptId && session.check_out_id ? (
            <div className="face-compare__cell">
              <span className="face-compare__label">Lúc ra</span>
              <div className="face-compare__frame">
                {exitUrl ? (
                  <img src={exitUrl} alt="Ảnh chụp lúc chấm ra" />
                ) : (
                  <p className="face-compare__missing">Không có ảnh kèm.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* What was refused that day, with the photo and the reason. Not shown
          when the panel is already open on one refused attempt. */}
      {!attemptId ? <RefusedAttempts attempts={session.attempts ?? []} /> : null}

      {/* Where they stood. */}
      {markers.length > 0 ? (
        <section>
          <h3 className="drawer__section">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            Vị trí chấm công
          </h3>
          <GeoMap circles={circles} markers={markers} height={280} fit />
          <p className="drawer__caption">
            {site?.address ?? site?.name ?? session.location_name ?? ""}
            {entryEvent?.distance_meters !== null && entryEvent?.distance_meters !== undefined
              ? ` · lúc vào cách ${entryEvent.distance_meters.toFixed(0)} m`
              : ""}
            {exitEvent?.distance_meters !== null && exitEvent?.distance_meters !== undefined
              ? ` · lúc ra cách ${exitEvent.distance_meters.toFixed(0)} m`
              : ""}
          </p>
        </section>
      ) : null}

      {selected ? (
        <section>
          {/* Which half of the day is on the form. */}
          {session.check_in_id && session.check_out_id && !attemptId ? (
            <div className="segmented" role="tablist" aria-label="Lượt cần xem">
              <button type="button" role="tab" aria-selected={half === "in"} className={half === "in" ? "is-active" : undefined} onClick={() => void switchHalf("in")}>
                Lượt vào
              </button>
              <button type="button" role="tab" aria-selected={half === "out"} className={half === "out" ? "is-active" : undefined} onClick={() => void switchHalf("out")}>
                Lượt ra
              </button>
            </div>
          ) : null}

          <DataList
            rows={[
              {
                key: "Trạng thái",
                value: <Badge tone={EVENT_STATUS[selected.status].tone}>{EVENT_STATUS[selected.status].label}</Badge>,
              },
              { key: "Thời điểm", value: formatDateTime(selected.server_time) },
              { key: "Địa điểm", value: selected.location_name },
              {
                key: "Cách địa điểm",
                value: selected.distance_meters === null ? "Không đo (bản ghi do người nhập)" : `${selected.distance_meters.toFixed(1)} m`,
              },
              ...(selected.failure_code
                ? [{ key: "Vì sao không hợp lệ", value: <span style={{ color: "var(--color-danger)" }}>{describeFailure(selected.failure_code)}</span> }]
                : []),
              ...(selected.minutes_late ? [{ key: "Vào muộn", value: describeMinutes(selected.minutes_late) }] : []),
              ...(selected.minutes_early_leave ? [{ key: "Ra sớm", value: describeMinutes(selected.minutes_early_leave) }] : []),
              ...(selected.reason ? [{ key: "Giải trình của thành viên", value: selected.reason }] : []),
              ...(selected.face_distance !== null || selected.face_match_score !== null
                ? [
                    {
                      key: "Khớp khuôn mặt",
                      value: `${selected.face_distance !== null ? `khoảng cách ${selected.face_distance.toFixed(3)}` : ""}${
                        selected.face_match_score !== null ? ` · ${(selected.face_match_score * 100).toFixed(0)}%` : ""
                      }`,
                    },
                  ]
                : []),
              ...(selected.edited_at
                ? [
                    {
                      key: "Đã được sửa",
                      value: `${formatDateTime(selected.edited_at)}${selected.edited_by_email ? ` · ${selected.edited_by_email}` : ""}${
                        selected.edit_reason ? ` · ${selected.edit_reason}` : ""
                      }`,
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
                ...(selected.original_server_time ? [{ key: "Thiết bị báo lúc đầu", value: formatDateTime(selected.original_server_time) }] : []),
                { key: "Lưu vào hệ thống lúc", value: formatDateTime(selected.created_at) },
                { key: "Nguồn bản ghi", value: SOURCE_LABEL[selected.source] ?? selected.source },
                ...(selected.gps_accuracy_meters !== null ? [{ key: "Sai số định vị", value: `${selected.gps_accuracy_meters.toFixed(0)} m` }] : []),
                ...(selected.latitude !== null && selected.longitude !== null
                  ? [{ key: "Toạ độ ghi nhận", value: <span className="mono">{selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}</span> }]
                  : []),
                { key: "Thư viện nhận diện", value: selected.face_engine ?? "—" },
                { key: "Mã bản ghi", value: <span className="mono">{selected.id}</span> },
              ]}
            />
          </details>
        </section>
      ) : null}

      {selected && canEdit ? (
        <section className="edit-box">
          <div className="edit-box__head">
            <h3 className="subhead">Sửa {selected.event_type === "CHECK_IN" ? "lượt vào" : "lượt ra"}</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowEdit((open) => !open)}>
              {showEdit ? "Thu gọn" : "Sửa bản ghi"}
            </Button>
          </div>

          {showEdit ? (
            <div className="stack stack--tight">
              {adjustNotice ? <Alert tone="success">{adjustNotice}</Alert> : null}
              {adjustError ? <Alert tone="danger">{adjustError}</Alert> : null}
              <div className="filter-row">
                <Field label="Thời điểm" type="datetime-local" value={editTime} onChange={(event) => setEditTime(event.target.value)} />
                <SelectField label="Địa điểm" value={editLocation} onChange={(event) => setEditLocation(event.target.value)}>
                  {locations.some((row) => row.id === editLocation) ? null : <option value={editLocation}>{selected.location_name}</option>}
                  {locations.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </SelectField>
              </div>
              <SelectField label="Trạng thái bản ghi" value={editVerdict} onChange={(event) => setEditVerdict(event.target.value as Verdict)}>
                {VERDICTS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </SelectField>
              <Field label="Giải trình của thành viên" placeholder="Ghi lại lời của thành viên nếu có" value={editNote} onChange={(event) => setEditNote(event.target.value)} />
              <TextAreaField
                label={isAdmin ? "Lý do sửa (không bắt buộc)" : "Lý do sửa (bắt buộc)"}
                required={!isAdmin}
                placeholder="Ví dụ: đồng hồ máy lệch 15 phút, đã đối chiếu camera cửa."
                value={adjustReason}
                onChange={(event) => setAdjustReason(event.target.value)}
              />
              <Button onClick={() => void submitAdjust()} loading={adjusting} disabled={!isAdmin && adjustReason.trim().length < 3} block>
                Lưu thay đổi
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {canDelete && !attemptId ? (
        <details className="danger-zone danger-zone--folded">
          <summary className="danger-zone__title">Xoá cả ngày công này</summary>
          <p className="danger-zone__text">
            Xoá hết lượt vào, lượt ra và cả những lần bị từ chối trong ngày này. Việc xoá được ghi vào nhật ký kèm tên bạn và lý do,
            quản trị hệ thống vẫn khôi phục lại được.
          </p>
          <TextAreaField label="Lý do xoá (bắt buộc)" placeholder="Ví dụ: chấm nhầm ca, thành viên bấm hai lần…" value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} />
          <Button variant="danger" onClick={() => void removeDay()} loading={deleting} disabled={deleteReason.trim().length < 3} block>
            Xoá cả ngày công
          </Button>
        </details>
      ) : null}

      <p className="drawer__foot">
        <span className="avatar avatar--sm" aria-hidden="true">
          {initials(session.member_name, session.member_email)}
        </span>
        {session.member_email}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import { api } from "../../lib/api";
import { describeError, describeFailure } from "../../lib/messages";
import { EVENT_STATUS, clock } from "../../lib/records";
import type { DaySession, ManagerAttendanceEvent } from "../../lib/types";
import { ZoomableImage } from "../Lightbox";
import { Alert, Badge, DataList, LoadingRows } from "../ui";

type Attempt = DaySession["attempts"][number];

/**
 * What the system refused that day, and why — shown inside a person's day
 * without the "Hiện cả lượt không hợp lệ" switch. The list outside stays
 * clean; the reasons are one tap deeper, where somebody asking "why did it
 * not let me in?" is answered with the photo it saw and the number it
 * measured.
 */
export function RefusedAttempts({
  attempts: all,
  onZoom,
}: {
  attempts: Attempt[];
  onZoom: (photo: { src: string; alt: string; caption?: string }) => void;
}) {
  const attempts = all.filter((attempt) => attempt.status === "BLOCKED" || attempt.status === "FAILED");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ManagerAttendanceEvent>>({});
  const [photos, setPhotos] = useState<Record<string, string | null>>({});

  useEffect(() => {
    return () => {
      for (const url of Object.values(photos)) {
        if (url) URL.revokeObjectURL(url);
      }
    };
    // Revoke once, on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(attempt: Attempt) {
    if (open === attempt.id) {
      setOpen(null);
      return;
    }
    setOpen(attempt.id);
    if (details[attempt.id]) return;
    try {
      const event = await api.managerAttendanceDetail(attempt.id);
      setDetails((current) => ({ ...current, [attempt.id]: event }));
      if (event.has_image) {
        const url = await api.managerAttendanceImage(attempt.id).catch(() => null);
        setPhotos((current) => ({ ...current, [attempt.id]: url }));
      } else {
        setPhotos((current) => ({ ...current, [attempt.id]: null }));
      }
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  if (attempts.length === 0 && !error) {
    return null;
  }

  return (
    <section>
      <h3 className="drawer__section">
        Lượt bị từ chối trong ngày <span className="drawer__count">{attempts.length}</span>
      </h3>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ul className="attempts">
        {attempts.map((attempt) => {
          const isOpen = open === attempt.id;
          const detail = details[attempt.id];
          const photo = photos[attempt.id];
          return (
            <li key={attempt.id} className={`${attempt.status === "FAILED" ? "is-face" : "is-place"}${isOpen ? " is-open" : ""}`}>
              <button type="button" className="attempts__row" onClick={() => void toggle(attempt)} aria-expanded={isOpen}>
                <span className="attempts__time mono">{clock(attempt.server_time)}</span>
                <span className="attempts__text">
                  <span className="attempts__what">
                    {attempt.event_type === "CHECK_IN" ? "Thử chấm vào" : "Thử chấm ra"}
                    {attempt.location_name ? ` · ${attempt.location_name}` : ""}
                  </span>
                  <span className="attempts__why">{describeFailure(attempt.failure_code) ?? "Không rõ lý do"}</span>
                </span>
                <Badge tone={EVENT_STATUS[attempt.status].tone}>{EVENT_STATUS[attempt.status].label}</Badge>
              </button>
              {isOpen ? (
                <div className="attempts__detail">
                  <div className={`attempts__photo${attempt.status === "FAILED" ? " is-face" : ""}`}>
                    {photo ? (
                      <ZoomableImage
                        src={photo}
                        alt={`Ảnh máy nhận lúc ${clock(attempt.server_time)}`}
                        caption={`${clock(attempt.server_time)} · ${describeFailure(attempt.failure_code) ?? ""}`}
                        onOpen={onZoom}
                      />
                    ) : detail && !detail.has_image ? (
                      <p className="face-compare__missing">Lượt này không lưu ảnh.</p>
                    ) : (
                      <span className="spinner" />
                    )}
                  </div>
                  {detail ? (
                    <DataList
                      rows={[
                        {
                          key: "Hệ thống báo",
                          value: <span style={{ color: "var(--color-danger)" }}>{describeFailure(detail.failure_code) ?? detail.failure_code ?? "—"}</span>,
                        },
                        ...(detail.distance_meters !== null
                          ? [{ key: "Cách địa điểm", value: `${detail.distance_meters.toFixed(1)} m` }]
                          : []),
                        ...(detail.gps_accuracy_meters !== null
                          ? [{ key: "Sai số định vị", value: `±${detail.gps_accuracy_meters.toFixed(0)} m` }]
                          : []),
                        ...(detail.face_distance !== null || detail.face_match_score !== null
                          ? [
                              {
                                key: "Khớp khuôn mặt",
                                value: [
                                  detail.face_distance !== null ? `khoảng cách ${detail.face_distance.toFixed(3)}` : null,
                                  detail.face_match_score !== null ? `${(detail.face_match_score * 100).toFixed(0)}%` : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · "),
                              },
                            ]
                          : []),
                        ...(detail.reason ? [{ key: "Người đó nói", value: detail.reason }] : []),
                        { key: "Mã bản ghi", value: <span className="mono">{detail.id}</span> },
                      ]}
                    />
                  ) : (
                    <LoadingRows count={2} />
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

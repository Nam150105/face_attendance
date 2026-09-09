"use client";

import { useEffect, useState } from "react";

import { Dialog } from "./Dialog";
import { Alert, Badge, Empty, LoadingRows } from "./ui";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/geo";
import { describeError } from "../lib/messages";
import { describeMinutes } from "../lib/member";
import type { ManagedMember } from "../lib/types";

const LOGIN_LABEL: Record<string, string> = {
  SUCCESS: "Vào được",
  BAD_PASSWORD: "Sai mật khẩu",
  NO_ACCOUNT: "Không có tài khoản",
  SUSPENDED: "Tài khoản bị khoá",
  RATE_LIMITED: "Bị chặn tạm thời",
  PASSWORD_CHANGED: "Đổi mật khẩu",
};

const LOGIN_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  SUCCESS: "success",
  BAD_PASSWORD: "warning",
  NO_ACCOUNT: "neutral",
  SUSPENDED: "danger",
  RATE_LIMITED: "danger",
  PASSWORD_CHANGED: "neutral",
};

function clock(value: string | null): string {
  return value
    ? new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
    : "—";
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail">
      <span className="detail__label">{label}</span>
      <span className="detail__value">{children}</span>
    </div>
  );
}

/**
 * Everything about one person, in one place.
 *
 * This used to be scattered: contact details on the roster, sign-in history
 * bolted onto an attendance record, the registered face somewhere else again.
 * A manager asking "who is this and how are they doing" had to visit three
 * screens and join them up mentally.
 *
 * What it shows is still cut to this manager's own places — a colleague who
 * shares the person keeps their site data to themselves.
 */
export function MemberDetail({ member, onClose }: { member: ManagedMember; onClose: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [logins, setLogins] = useState<{
    totals: Record<string, number>;
    items: { outcome: string; created_at: string; user_agent: string | null }[];
  } | null>(null);
  const [sessions, setSessions] = useState<
    { work_date: string; check_in: string | null; check_out: string | null;
      minutes_late: number; location_name: string | null; status: string }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    api
      .memberFacePhoto(member.user_id)
      .then((value) => {
        url = value;
        setPhoto(value);
      })
      .catch(() => setPhoto(null));
    api.memberLoginHistory(member.user_id, 10).then(setLogins).catch(() => setLogins(null));
    api
      .managerAttendanceSessions({ member_id: member.user_id, limit: 8 })
      .then((result) => setSessions(result.items))
      .catch((cause) => setError(describeError(cause)));
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [member.user_id]);

  return (
    <Dialog title={member.full_name ?? member.email} onClose={onClose}>
      <div className="stack">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="profile-head">
          {photo ? (
            <img src={photo} alt="Ảnh khuôn mặt đã đăng ký" className="profile-head__photo" />
          ) : (
            <div className="profile-head__photo profile-head__photo--empty">Chưa có ảnh</div>
          )}
          <div className="detail-grid">
            <Detail label="Email">{member.email}</Detail>
            <Detail label="Điện thoại">{member.phone ?? "—"}</Detail>
            <Detail label="Đơn vị">{member.department ?? "—"}</Detail>
            <Detail label="Chức danh">{member.position ?? "—"}</Detail>
            <Detail label="Mã định danh">{member.employee_code ?? "—"}</Detail>
            <Detail label="Trạng thái">
              <Badge tone={member.membership_status === "ACTIVE" ? "success" : "warning"}>
                {member.membership_status === "ACTIVE" ? "Đang hoạt động" : "Tạm ngưng"}
              </Badge>
            </Detail>
          </div>
        </div>

        <div>
          <h3 className="subhead">Ngày công gần đây tại nơi của bạn</h3>
          {sessions === null ? (
            <LoadingRows count={3} />
          ) : sessions.length === 0 ? (
            <Empty>Chưa có ngày công nào tại địa điểm của bạn.</Empty>
          ) : (
            <div className="stack stack--tight">
              {/* One day, one line. As a table this became four stacked
                  label/value pairs per day on a phone. */}
              {sessions.map((row) => (
                <div className="line" key={row.work_date}>
                  <div className="line__body">
                    <p className="person__name">{row.work_date.split("-").reverse().join("/")}</p>
                    <p className="event__meta">
                      Vào {clock(row.check_in)} → {row.check_out ? clock(row.check_out) : "chưa ra"}
                      {row.location_name ? ` · ${row.location_name}` : ""}
                    </p>
                  </div>
                  {row.minutes_late > 0 ? (
                    <Badge tone="danger">Muộn {describeMinutes(row.minutes_late)}</Badge>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="subhead">Lần đăng nhập gần đây</h3>
          {logins === null ? (
            <LoadingRows count={2} />
          ) : logins.items.length === 0 ? (
            <Empty>Chưa ghi nhận lần đăng nhập nào.</Empty>
          ) : (
            <>
              <p className="event__meta">
                {[
                  logins.totals.SUCCESS ? `${logins.totals.SUCCESS} lần vào được` : null,
                  logins.totals.BAD_PASSWORD ? `${logins.totals.BAD_PASSWORD} lần sai mật khẩu` : null,
                  logins.totals.RATE_LIMITED ? `${logins.totals.RATE_LIMITED} lần bị chặn` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="stack stack--tight" style={{ marginTop: 6 }}>
                {logins.items.slice(0, 5).map((attempt, index) => (
                  <div className="team" key={index}>
                    <Badge tone={LOGIN_TONE[attempt.outcome] ?? "neutral"}>
                      {LOGIN_LABEL[attempt.outcome] ?? attempt.outcome}
                    </Badge>
                    <div className="team__body">
                      <p className="event__meta">{formatDateTime(attempt.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

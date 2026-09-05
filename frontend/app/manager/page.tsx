"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ManagerShell } from "../../components/ManagerShell";
import { Alert, Badge, Card, Empty, LoadingRows } from "../../components/ui";
import { api } from "../../lib/api";
import { describeError } from "../../lib/messages";
import type { ManagerDashboard } from "../../lib/types";

function shortTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function weekday(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  const labels = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  return labels[date.getDay()];
}

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2)).toUpperCase();
}

export default function ManagerHomePage() {
  const [data, setData] = useState<ManagerDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .managerDashboard()
      .then(setData)
      .catch((cause) => setError(describeError(cause)));
  }, []);

  if (error) {
    return (
      <ManagerShell>
        <h1 className="page-title">Tổng quan</h1>
        <Alert tone="danger">{error}</Alert>
      </ManagerShell>
    );
  }

  if (!data) {
    return (
      <ManagerShell>
        <h1 className="page-title">Tổng quan</h1>
        <Card>
          <LoadingRows count={4} />
        </Card>
      </ManagerShell>
    );
  }

  const peak = Math.max(1, ...data.daily.map((day) => day.check_in + day.check_out));
  const notEnrolled = data.active_members - data.members_with_face;
  const idle = data.active_members - data.currently_checked_in;

  return (
    <ManagerShell>
      <h1 className="page-title">Tổng quan</h1>
      <p className="page-lead">Phạm vi: thành viên bạn quản lý.</p>

      <div className="tiles">
        <div className="tile tile--primary">
          <p className="tile__value">{data.currently_checked_in}</p>
          <p className="tile__label">Đang trong ca</p>
          <p className="tile__foot">{idle > 0 ? `${idle} người chưa vào ca` : "Tất cả đã vào ca"}</p>
        </div>
        <div className="tile">
          <p className="tile__value">{data.events_today}</p>
          <p className="tile__label">Lượt chấm công hôm nay</p>
          <p className="tile__foot">Tính từ 00:00</p>
        </div>
        <div className={`tile ${notEnrolled > 0 ? "tile--warning" : "tile--success"}`}>
          <p className="tile__value">
            {data.members_with_face}
            <span className="tile__of">/{data.active_members}</span>
          </p>
          <p className="tile__label">Đã có khuôn mặt</p>
          <p className="tile__foot">{notEnrolled > 0 ? `${notEnrolled} người chưa đăng ký` : "Đầy đủ"}</p>
        </div>
        <div className="tile">
          <p className="tile__value">{data.active_locations}</p>
          <p className="tile__label">Địa điểm đang bật</p>
          <p className="tile__foot">
            <Link className="link" href="/manager/locations">
              Quản lý
            </Link>
          </p>
        </div>
      </div>

      <Card title="7 ngày gần nhất">
        <div className="chart" role="img" aria-label="Biểu đồ lượt chấm công 7 ngày gần nhất">
          {data.daily.map((day) => {
            const total = day.check_in + day.check_out;
            return (
              <div className="chart__col" key={day.date}>
                <span className="chart__count">{total || ""}</span>
                <div className="chart__stack" title={`${day.date}: ${day.check_in} vào, ${day.check_out} ra`}>
                  <span
                    className="chart__bar chart__bar--out"
                    style={{ height: `${(day.check_out / peak) * 100}%` }}
                  />
                  <span
                    className="chart__bar chart__bar--in"
                    style={{ height: `${(day.check_in / peak) * 100}%` }}
                  />
                </div>
                <span className="chart__label">{weekday(day.date)}</span>
              </div>
            );
          })}
        </div>
        <div className="legend">
          <span className="legend__item">
            <span className="legend__swatch legend__swatch--in" /> Check-in
          </span>
          <span className="legend__item">
            <span className="legend__swatch legend__swatch--out" /> Check-out
          </span>
        </div>
      </Card>

      <Card
        title="Thành viên"
        action={
          <Link className="link" href="/manager/members">
            Quản lý
          </Link>
        }
      >
        {data.members.length === 0 ? (
          <Empty>Chưa có thành viên. Thêm bằng email đã đăng ký.</Empty>
        ) : (
          <ul className="people">
            {data.members.map((member) => (
              <li className="person" key={member.member_id}>
                <span
                  className={`person__avatar ${member.checked_in_at ? "person__avatar--active" : ""}`}
                  aria-hidden="true"
                >
                  {initials(member.full_name, member.email)}
                </span>
                <div className="person__body">
                  <p className="person__name">{member.full_name ?? member.email}</p>
                  <p className="event__meta">
                    {member.checked_in_at
                      ? `Vào ca ${shortTime(member.checked_in_at)}`
                      : member.last_event_at
                        ? `Lần cuối ${shortTime(member.last_event_at)}`
                        : "Chưa chấm công lần nào"}
                  </p>
                </div>
                <div className="person__tags">
                  {!member.face_enrolled ? <Badge tone="warning">Chưa có mặt</Badge> : null}
                  <Badge tone={member.checked_in_at ? "success" : "neutral"}>
                    {member.checked_in_at ? "Trong ca" : "Ngoài ca"}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ManagerShell>
  );
}

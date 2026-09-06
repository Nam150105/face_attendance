"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ManagerShell } from "../../components/ManagerShell";
import { Alert, Badge, Button, Card, Empty, LoadingRows } from "../../components/ui";
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
  const labels = ["CN", "Th 2", "Th 3", "Th 4", "Th 5", "Th 6", "Th 7"];
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
  const [hoveredDay, setHoveredDay] = useState<{ date: string; in: number; out: number; total: number } | null>(null);

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
  const enrollRate = data.active_members > 0 ? Math.round((data.members_with_face / data.active_members) * 100) : 0;
  const activeRate = data.active_members > 0 ? Math.round((data.currently_checked_in / data.active_members) * 100) : 0;

  return (
    <ManagerShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tổng quan</h1>
          <p className="page-lead">Ai đang có mặt, ai đến muộn và tình hình chấm công hôm nay.</p>
        </div>
        <div className="row">
          <Link href="/manager/attendance">
            <Button size="sm" variant="secondary">
              Xem bản ghi
            </Button>
          </Link>
          <Link href="/manager/members">
            <Button size="sm">
              Thêm thành viên
            </Button>
          </Link>
        </div>
      </div>

      {/* 4 Commercial Metric KPI Cards */}
      <div className="tiles">
        <div className="tile tile--primary">
          <div className="tile__head">
            <span className="tile__label">Đang trong phiên</span>
            <Badge tone="success">{activeRate}%</Badge>
          </div>
          <p className="tile__value">{data.currently_checked_in}</p>
          <p className="tile__foot">
            {idle > 0 ? `${idle} thành viên chưa check-in hôm nay` : "Tất cả thành viên đã check-in"}
          </p>
        </div>

        <div className="tile">
          <div className="tile__head">
            <span className="tile__label">Lượt ghi nhận hôm nay</span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-cyan)" }}>Từ 00:00</span>
          </div>
          <p className="tile__value">{data.events_today}</p>
          <p className="tile__foot">Gồm cả check-in và check-out</p>
        </div>

        <div className={`tile ${notEnrolled > 0 ? "tile--warning" : "tile--success"}`}>
          <div className="tile__head">
            <span className="tile__label">Đã đăng ký khuôn mặt</span>
            <Badge tone={enrollRate >= 100 ? "success" : "warning"}>{enrollRate}%</Badge>
          </div>
          <p className="tile__value">
            {data.members_with_face}
            <span className="tile__of">/{data.active_members}</span>
          </p>
          <p className="tile__foot">
            {notEnrolled > 0 ? `Còn ${notEnrolled} thành viên chưa đăng ký` : "Tất cả thành viên đã đăng ký"}
          </p>
        </div>

        <div className="tile">
          <div className="tile__head">
            <span className="tile__label">Địa điểm đang bật</span>
            <Link className="link" href="/manager/locations" style={{ fontSize: "var(--text-xs)", color: "var(--color-primary)" }}>
              Quản lý
            </Link>
          </div>
          <p className="tile__value">{data.active_locations}</p>
          <p className="tile__foot">Số địa điểm cho phép ghi nhận</p>
        </div>
      </div>

      {/* 7-Day Attendance Chart Card */}
      <Card
        className="chart-card"
        title="Hoạt động 7 ngày gần nhất"
        subtitle={
          hoveredDay
            ? `${hoveredDay.date}: ${hoveredDay.in} check-in · ${hoveredDay.out} check-out (tổng ${hoveredDay.total})`
            : "Chọn một cột để xem số lượt check-in và check-out của ngày đó."
        }
      >
        <div className="chart-bars">
          {data.daily.map((day) => {
            const total = day.check_in + day.check_out;
            const inHeight = peak > 0 ? (day.check_in / peak) * 100 : 0;
            const outHeight = peak > 0 ? (day.check_out / peak) * 100 : 0;
            const isHovered = hoveredDay?.date === day.date;

            return (
              <div
                className="chart-col"
                key={day.date}
                onMouseEnter={() => setHoveredDay({ date: day.date, in: day.check_in, out: day.check_out, total })}
                onMouseLeave={() => setHoveredDay(null)}
                onClick={() => setHoveredDay({ date: day.date, in: day.check_in, out: day.check_out, total })}
              >
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: isHovered ? "var(--color-cyan)" : "var(--text-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {total > 0 ? total : ""}
                </span>
                <div
                  className="chart-bar-group"
                  style={{
                    background: isHovered ? "rgba(59, 130, 246, 0.15)" : undefined,
                    boxShadow: isHovered ? "0 0 10px rgba(59, 130, 246, 0.3)" : undefined,
                  }}
                >
                  <div className="chart-bar chart-bar--in" style={{ height: `${Math.max(4, inHeight)}%` }} title={`Check-in: ${day.check_in}`} />
                  <div className="chart-bar chart-bar--out" style={{ height: `${Math.max(4, outHeight)}%` }} title={`Check-out: ${day.check_out}`} />
                </div>
                <span className="chart-col-label">{weekday(day.date)}</span>
              </div>
            );
          })}
        </div>

        <div className="chart-legend">
          <div className="chart-legend-item">
            <span className="chart-legend-dot" style={{ background: "linear-gradient(180deg, #60a5fa, #2563eb)" }} />
            <span>Check-in</span>
          </div>
          <div className="chart-legend-item">
            <span className="chart-legend-dot" style={{ background: "linear-gradient(180deg, #a78bfa, #7c3aed)" }} />
            <span>Check-out</span>
          </div>
        </div>
      </Card>

      {/* Members Attendance Status List Card */}
      <Card
        title="Thành viên & trạng thái"
        subtitle="Ai đang trong phiên và ai chưa check-in hôm nay."
        action={
          <Link href="/manager/members">
            <Button variant="ghost" size="sm">
              Xem tất cả →
            </Button>
          </Link>
        }
      >
        {data.members.length === 0 ? (
          <Empty>Chưa có thành viên nào trong danh sách bạn quản lý.</Empty>
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
                      ? `Đã check-in lúc ${shortTime(member.checked_in_at)}`
                      : member.last_event_at
                        ? `Lần gần nhất lúc ${shortTime(member.last_event_at)}`
                        : "Chưa có lượt ghi nhận nào"}
                  </p>
                </div>
                <div className="person__tags">
                  {!member.face_enrolled ? <Badge tone="warning">Chưa đăng ký mặt</Badge> : null}
                  <Badge tone={member.checked_in_at ? "success" : "neutral"}>
                    {member.checked_in_at ? "Trong phiên" : "Ngoài phiên"}
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

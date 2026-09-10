"use client";

import Link from "next/link";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../components/AppShell";
import { Alert, Badge, Button, Card, DataList, Empty, LoadingRows } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { formatDateTime, formatDistance, isSecureContextReady } from "../lib/geo";
import { describeError, describeFailure } from "../lib/messages";
import type {
  AttendanceEvent,
  AttendanceState,
  CurrentUser,
  FaceEnrollmentStatus,
  MemberLocation,
  MemberProfile,
} from "../lib/types";

interface DashboardData {
  user: CurrentUser;
  profile: MemberProfile | null;
  state: AttendanceState | null;
  face: FaceEnrollmentStatus | null;
  locations: MemberLocation[];
  history: AttendanceEvent[];
}

/** Greet people by the name they entered; fall back to the email handle. */
function displayName(profile: MemberProfile | null, email: string): string {
  const full = profile?.full_name?.trim();
  if (full) {
    return full;
  }
  return email.split("@")[0];
}

function getGreeting(name?: string | null): string {
  const hour = new Date().getHours();
  const title = hour < 12 ? "Chào buổi sáng" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";
  return name ? `${title}, ${name}` : title;
}

function formatElapsed(fromIso: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(fromIso).getTime());
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Why check-in is unavailable, in a sentence the person can act on.
 *
 * The server decides this (`can_check_in`), not the screen: the same rule then
 * holds for anybody who reaches the page by typing the address.
 */
const BLOCKED_TEXT: Record<string, { title: string; body: string; action?: { label: string; href: string } }> = {
  NO_MANAGER: {
    title: "Bạn chưa được duyệt vào nhóm nào",
    body: "Người quản lý duyệt xong bạn mới chấm công được. Nếu đã có mã nhóm, vào Hồ sơ nhập mã rồi chờ duyệt.",
    action: { label: "Mở hồ sơ", href: "/profile" },
  },
  NO_LOCATION: {
    title: "Bạn chưa được gán nơi chấm công",
    body: "Nhóm của bạn chưa có địa điểm nào, hoặc bạn chưa được gán vào địa điểm nào. Hãy báo người quản lý.",
  },
  NO_FACE: {
    title: "Bạn chưa đăng ký khuôn mặt",
    body: "Chụp một ảnh để hệ thống nhận ra bạn, chỉ mất chưa tới một phút.",
    action: { label: "Đăng ký khuôn mặt", href: "/enroll" },
  },
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [noTeam, setNoTeam] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await api.me();
      if (user.role !== "MEMBER") {
        router.replace(user.role === "SUPER_ADMIN" ? "/admin" : "/manager");
        return;
      }
      const [profile, state, face, locations, history] = await Promise.all([
        api.memberProfile().catch(() => null),
        api.attendanceState(),
        api.faceStatus(),
        api.memberLocations(),
        api.attendanceHistory(10),
      ]);
      setData({ user, profile, state, face, locations, history });
    } catch (cause) {
      if (cause instanceof ApiError && cause.statusCode === 401) {
        router.replace("/login");
        return;
      }
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // Somebody with no manager cannot be assigned a place, so nothing else on
    // this page will work for them until they join one.
    api
      .myManagers()
      .then((managers) => setNoTeam(managers.length === 0))
      .catch(() => setNoTeam(false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live Shift Timer
  useEffect(() => {
    if (!data?.state?.open_check_in_time) {
      setElapsed("");
      return;
    }
    const update = () => setElapsed(formatElapsed(data.state!.open_check_in_time!));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [data?.state?.open_check_in_time]);

  if (loading) {
    return (
      <AppShell>
        <div className="page-header">
          <div>
            <h1 className="page-title">Trang chủ</h1>
            <p className="page-lead">Đang tải dữ liệu…</p>
          </div>
        </div>
        <Card>
          <LoadingRows count={4} />
        </Card>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <h1 className="page-title">Trang chủ</h1>
        <Card>
          <div className="stack">
            <Alert tone="danger">{error ?? "Không tải được dữ liệu."}</Alert>
            <Button variant="secondary" onClick={() => void load()}>
              Thử tải lại
            </Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  const state = data.state as AttendanceState;
  const face = data.face as FaceEnrollmentStatus;
  const checkedIn = state.state === "CHECKED_IN";
  const memberName = displayName(data.profile, data.user.email);
  // One source of truth for "can this person check in", handed down by the API.
  const blocked = state.can_check_in ? null : BLOCKED_TEXT[state.blocked_reason ?? ""] ?? null;

  return (
    <AppShell email={data.user.email}>

      <div className="page-header">
        <div>
          <h1 className="page-title">{getGreeting(memberName)}</h1>
          <p className="page-lead">Ghi nhận hiện diện bằng nhận diện khuôn mặt và định vị GPS.</p>
        </div>
        <Badge tone={checkedIn ? "success" : "neutral"}>
          {checkedIn ? "● Đang trong phiên" : "○ Chưa mở phiên"}
        </Badge>
      </div>

      {blocked ? (
        <Alert tone="warning">
          <strong>{blocked.title}.</strong> {blocked.body}
          {blocked.action ? (
            <>
              {" "}
              <Link href={blocked.action.href} className="alert__action">
                {blocked.action.label}
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}

      {!isSecureContextReady() ? (
        <Alert tone="warning">
          Kết nối hiện chưa được mã hoá. Để dùng camera và định vị, vui lòng truy cập bằng đường dẫn HTTPS.
        </Alert>
      ) : null}

      {/* Main Shift Status Card with Live Timer */}
      <Card
        glow={checkedIn}
        title={checkedIn ? "Phiên đang mở" : "Bắt đầu một phiên mới"}
        subtitle={
          checkedIn
            ? "Bạn đã check-in. Hãy check-out khi kết thúc."
            : "Xác thực bằng khuôn mặt và vị trí để ghi nhận."
        }
        action={
          checkedIn && elapsed ? (
            <span
              className="mono"
              style={{
                fontSize: "var(--text-lg)",
                fontWeight: 700,
                color: "var(--color-success)",
                background: "var(--color-success-soft)",
                padding: "4px 12px",
                borderRadius: "var(--radius-full)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
              }}
            >
              ⏱ {elapsed}
            </span>
          ) : null
        }
      >
        <div className="stack">
          <DataList
            rows={[
              {
                key: "Hồ sơ khuôn mặt",
                value: face.enrolled ? (
                  <Badge tone="success">Đã đăng ký</Badge>
                ) : (
                  <Badge tone="warning">Chưa đăng ký</Badge>
                ),
              },
              {
                // A count answers nothing: you check in at one place, so name
                // the one you will actually use.
                key: "Nơi chấm công",
                value:
                  data.locations.length === 0
                    ? "Chưa có nơi nào"
                    : (data.locations.find((item) => item.is_default) ?? data.locations[0]).name +
                      (data.locations.length > 1 ? " (chọn nơi khác khi chấm công)" : ""),
              },
              {
                key: "Thời điểm check-in",
                value: state.open_check_in_time ? formatDateTime(state.open_check_in_time) : "Chưa check-in",
              },
            ]}
          />

          <div className="row" style={{ marginTop: "var(--space-1)" }}>
            <Button
              size="lg"
              variant={checkedIn ? "secondary" : "primary"}
              disabled={blocked !== null && state.blocked_reason !== "NO_FACE"}
              onClick={() => router.push(face.enrolled ? "/attendance" : "/enroll")}
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              }
              block
            >
              {face.enrolled ? (checkedIn ? "Check-out — kết thúc phiên" : "Check-in — bắt đầu phiên") : "Đăng ký khuôn mặt"}
            </Button>
          </div>

        </div>
      </Card>

      {/* Recent Attendance Activity Card */}
      <Card
        title="Hoạt động gần đây"
        action={
          data.history.length > 0 ? (
            <Link href="/history" className="link">
              Xem cả bảng công
            </Link>
          ) : null
        }
      >
        {data.history.length === 0 ? (
          <Empty>Chưa có bản ghi nào.</Empty>
        ) : (
          <div>
            {data.history.slice(0, 4).map((event) => {
              const isSuccess = event.status === "SUCCESS";
              const isWarning = event.status === "WARNING_CONFIRMED";
              return (
                <div className="event" key={event.id}>
                  <div>
                    <p className="event__label">
                      {event.event_type === "CHECK_IN" ? "Check-in" : "Check-out"} · {event.location_name}
                    </p>
                    <p className="event__meta">
                      {formatDateTime(event.server_time)} · Cách địa điểm {formatDistance(event.distance_meters)}
                      {event.failure_code ? ` · ${describeFailure(event.failure_code)}` : ""}
                    </p>
                  </div>
                  <Badge tone={isSuccess ? "success" : isWarning ? "warning" : "danger"}>
                    {isSuccess ? "Hợp lệ" : isWarning ? "Đã ghi lý do" : "Không hợp lệ"}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </AppShell>
  );
}

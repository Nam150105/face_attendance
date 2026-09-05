"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../components/AppShell";
import { Alert, Badge, Button, Card, DataList, Empty, LoadingRows } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { formatDateTime, formatDistance, isSecureContextReady } from "../lib/geo";
import { describeError, describeFailure } from "../lib/messages";
import type { AttendanceEvent, AttendanceState, CurrentUser, FaceEnrollmentStatus, MemberLocation } from "../lib/types";

interface DashboardData {
  user: CurrentUser;
  state: AttendanceState | null;
  face: FaceEnrollmentStatus | null;
  locations: MemberLocation[];
  history: AttendanceEvent[];
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await api.me();
      if (user.role !== "MEMBER") {
        router.replace("/manager");
        return;
      }
      const [state, face, locations, history] = await Promise.all([
        api.attendanceState(),
        api.faceStatus(),
        api.memberLocations(),
        api.attendanceHistory(10),
      ]);
      setData({ user, state, face, locations, history });
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
    void load();
  }, [load]);

  if (loading) {
    return (
      <AppShell>
        <h1 className="page-title">Bảng điều khiển</h1>
        <Card>
          <LoadingRows count={4} />
        </Card>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <h1 className="page-title">Bảng điều khiển</h1>
        <Card>
          <div className="stack">
            <Alert tone="danger">{error ?? "Không tải được dữ liệu."}</Alert>
            <Button variant="secondary" onClick={() => void load()}>
              Thử lại
            </Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  const state = data.state as AttendanceState;
  const face = data.face as FaceEnrollmentStatus;
  const checkedIn = state.state === "CHECKED_IN";

  return (
    <AppShell email={data.user.email}>
      <h1 className="page-title">Bảng điều khiển</h1>
      <p className="page-lead">Trạng thái ca làm và dữ liệu khuôn mặt.</p>

      {!isSecureContextReady() ? (
        <Alert tone="warning">
          Kết nối không bảo mật. Camera và GPS chỉ hoạt động trên https://.
        </Alert>
      ) : null}

      <Card
        title="Trạng thái hiện tại"
        subtitle={checkedIn ? "Đang trong ca." : "Chưa check-in."}
        action={<Badge tone={checkedIn ? "success" : "neutral"}>{checkedIn ? "TRONG CA" : "NGOÀI CA"}</Badge>}
      >
        <div className="stack">
          <DataList
            rows={[
              {
                key: "Dữ liệu khuôn mặt",
                value: face.enrolled ? (
                  <Badge tone="success">Đã đăng ký</Badge>
                ) : (
                  <Badge tone="warning">Chưa đăng ký</Badge>
                ),
              },
              { key: "Địa điểm", value: String(data.locations.length) },
              {
                key: "Vào ca",
                value: state.open_check_in_time ? formatDateTime(state.open_check_in_time) : "—",
              },
            ]}
          />

          {!face.enrolled ? (
            <Alert tone="warning">Cần đăng ký khuôn mặt trước khi chấm công.</Alert>
          ) : null}
          {data.locations.length === 0 ? (
            <Alert tone="warning">
              Chưa được gán địa điểm. Liên hệ quản lý.
            </Alert>
          ) : null}

          <div className="row">
            <Button onClick={() => router.push(face.enrolled ? "/attendance" : "/enroll")} block>
              {face.enrolled ? (checkedIn ? "Check-out" : "Check-in") : "Đăng ký khuôn mặt"}
            </Button>
          </div>
          {face.enrolled ? (
            <Button variant="secondary" onClick={() => router.push("/enroll")}>
              Đăng ký lại
            </Button>
          ) : null}
        </div>
      </Card>

      <Card title="Địa điểm">
        {data.locations.length === 0 ? (
          <Empty>Chưa có địa điểm.</Empty>
        ) : (
          <div className="stack stack--tight">
            {data.locations.map((location) => (
              <div className="event" key={location.id}>
                <div>
                  <p className="event__label">{location.name}</p>
                  <p className="event__meta">
                    {location.address ?? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`}
                  </p>
                </div>
                <div className="row">
                  {location.is_default ? <Badge tone="info">Mặc định</Badge> : null}
                  <Badge tone="neutral">{location.allow_radius_meters} m</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Lịch sử">
        {data.history.length === 0 ? (
          <Empty>Chưa có bản ghi.</Empty>
        ) : (
          <div>
            {data.history.map((event) => (
              <div className="event" key={event.id}>
                <div>
                  <p className="event__label">
                    {event.event_type === "CHECK_IN" ? "Check-in" : "Check-out"} · {event.location_name}
                  </p>
                  <p className="event__meta">
                    {formatDateTime(event.server_time)} · cách {formatDistance(event.distance_meters)}
                    {event.failure_code ? ` · ${describeFailure(event.failure_code)}` : ""}
                  </p>
                </div>
                <Badge tone={event.status === "SUCCESS" ? "success" : event.status === "WARNING_CONFIRMED" ? "warning" : "danger"}>
                  {event.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </AppShell>
  );
}

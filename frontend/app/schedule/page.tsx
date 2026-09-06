"use client";

import { useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { MemberNav } from "../../components/MemberNav";
import { Alert, Badge, Card, DataList, Empty, LoadingRows } from "../../components/ui";
import { api } from "../../lib/api";
import { clockOf, shortTime, weekdayLabel } from "../../lib/member";
import { describeError } from "../../lib/messages";
import type { CurrentUser, ScheduleResponse } from "../../lib/types";

export default function SchedulePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(setUser).catch(() => undefined);
    api
      .mySchedule()
      .then(setData)
      .catch((cause) => setError(describeError(cause)));
  }, []);

  const today = data?.today;
  const recurring = (data?.shifts ?? []).filter((shift) => shift.work_date === null);
  const oneOff = (data?.shifts ?? []).filter((shift) => shift.work_date !== null);

  return (
    <AppShell email={user?.email} wide>
      <MemberNav />

      <div className="page-header">
        <div>
          <h1 className="page-title">Lịch làm việc</h1>
          <p className="page-lead">Ca được phân công và địa điểm tương ứng.</p>
        </div>
        {today ? (
          <Badge tone={today.has_shift ? (today.checked_in_at ? "success" : "info") : "neutral"}>
            {today.has_shift
              ? today.checked_in_at
                ? "Hôm nay: đã check-in"
                : "Hôm nay: chưa check-in"
              : "Hôm nay: không có ca"}
          </Badge>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card title="Hôm nay">
        {data === null && !error ? (
          <LoadingRows count={3} />
        ) : today?.has_shift ? (
          <DataList
            rows={[
              { key: "Giờ bắt đầu", value: shortTime(today.start_time) },
              { key: "Giờ kết thúc", value: shortTime(today.end_time) },
              {
                key: "Cho phép muộn",
                value: today.grace_minutes !== null ? `${today.grace_minutes} phút` : "—",
              },
              {
                key: "Check-in hôm nay",
                value: today.checked_in_at ? clockOf(today.checked_in_at) : "Chưa check-in",
              },
            ]}
          />
        ) : (
          <Empty>Hôm nay bạn không có ca làm việc nào được phân công.</Empty>
        )}
      </Card>

      <Card title="Ca lặp hằng tuần" subtitle="Áp dụng cho mọi tuần cho tới khi người quản lý thay đổi.">
        {data === null && !error ? (
          <LoadingRows count={3} />
        ) : recurring.length === 0 ? (
          <Empty>Chưa có ca cố định nào. Người quản lý là người thiết lập lịch này.</Empty>
        ) : (
          <div className="stack stack--tight">
            {recurring.map((shift) => (
              <div className="event" key={shift.id}>
                <div>
                  <p className="event__label">{weekdayLabel(shift.weekday)}</p>
                  <p className="event__meta">
                    {shift.location_name ?? "Chưa gán địa điểm"}
                    {shift.location_address ? ` · ${shift.location_address}` : ""}
                  </p>
                </div>
                <Badge tone="info">
                  {shortTime(shift.start_time)} – {shortTime(shift.end_time)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {oneOff.length > 0 ? (
        <Card title="Ca theo ngày cụ thể" subtitle="Ghi đè lên ca lặp hằng tuần của ngày đó.">
          <div className="stack stack--tight">
            {oneOff.map((shift) => (
              <div className="event" key={shift.id}>
                <div>
                  <p className="event__label">{shift.work_date}</p>
                  <p className="event__meta">{shift.location_name ?? "Chưa gán địa điểm"}</p>
                </div>
                <Badge tone="warning">
                  {shortTime(shift.start_time)} – {shortTime(shift.end_time)}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </AppShell>
  );
}

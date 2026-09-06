"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Dialog } from "../../components/Dialog";
import { MemberNav } from "../../components/MemberNav";
import { Alert, Badge, Button, Card, DataList, Empty, Field, LoadingRows, SelectField } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { formatDateTime, formatDistance } from "../../lib/geo";
import {
  DAY_STATUS,
  clockOf,
  currentMonthValue,
  dayLabel,
  formatMinutes,
  monthRange,
  shortTime,
} from "../../lib/member";
import { describeError, describeFailure } from "../../lib/messages";
import type { AttendanceDayEvent, AttendanceDaysResponse, CurrentUser, DayStatus } from "../../lib/types";

type Mode = "month" | "range";

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "VALID", label: "Hợp lệ" },
  { value: "LATE", label: "Đi muộn" },
  { value: "MISSING_CHECK_OUT", label: "Thiếu check-out" },
  { value: "INVALID", label: "Không hợp lệ" },
];

export default function HistoryPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [mode, setMode] = useState<Mode>("month");
  const [month, setMonth] = useState(currentMonthValue());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<AttendanceDaysResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [openDay, setOpenDay] = useState<string | null>(null);
  const [dayEvents, setDayEvents] = useState<AttendanceDayEvent[] | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null);
    setError(null);
    try {
      const range = mode === "month" ? monthRange(month) : { date_from: from || undefined, date_to: to || undefined };
      setData(await api.attendanceDays(range));
    } catch (cause) {
      if (cause instanceof ApiError && cause.statusCode === 401) {
        router.replace("/login");
        return;
      }
      setError(describeError(cause));
    }
  }, [mode, month, from, to, router]);

  useEffect(() => {
    api.me().then(setUser).catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(workDate: string) {
    setOpenDay(workDate);
    setDayEvents(null);
    setDayError(null);
    try {
      setDayEvents(await api.attendanceDay(workDate));
    } catch (cause) {
      setDayError(describeError(cause));
    }
  }

  const days = (data?.days ?? []).filter((day) => (status ? day.status === status : true));

  return (
    <AppShell email={user?.email} wide>
      <MemberNav />

      <div className="page-header">
        <div>
          <h1 className="page-title">Lịch sử chấm công</h1>
          <p className="page-lead">Tổng hợp theo ngày: giờ vào, giờ ra, tổng thời gian và trạng thái.</p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card className="filter-card">
        <div className="filters-bar filters-bar--compact">
          <SelectField label="Xem theo" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="month">Theo tháng</option>
            <option value="range">Khoảng ngày</option>
          </SelectField>

          {mode === "month" ? (
            <Field label="Tháng" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          ) : (
            <>
              <Field label="Từ ngày" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Field label="Đến ngày" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          )}

          <SelectField label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_FILTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </SelectField>
        </div>
      </Card>

      {data ? (
        <div className="tiles">
          <div className="tile">
            <div className="tile__head">
              <span className="tile__label">Ngày có mặt</span>
            </div>
            <p className="tile__value">{data.summary.days_present}</p>
            <p className="tile__foot">Trong khoảng đang xem</p>
          </div>
          <div className="tile">
            <div className="tile__head">
              <span className="tile__label">Tổng thời gian</span>
            </div>
            <p className="tile__value">{Math.floor(data.summary.total_worked_minutes / 60)}
              <span className="tile__of">giờ</span>
            </p>
            <p className="tile__foot">{formatMinutes(data.summary.total_worked_minutes)}</p>
          </div>
          <div className={`tile ${data.summary.days_late > 0 ? "tile--warning" : ""}`}>
            <div className="tile__head">
              <span className="tile__label">Đi muộn</span>
            </div>
            <p className="tile__value">{data.summary.days_late}</p>
            <p className="tile__foot">So với ca làm việc được phân</p>
          </div>
          <div className={`tile ${data.summary.days_missing_check_out > 0 ? "tile--warning" : ""}`}>
            <div className="tile__head">
              <span className="tile__label">Thiếu check-out</span>
            </div>
            <p className="tile__value">{data.summary.days_missing_check_out}</p>
            <p className="tile__foot">Có thể gửi yêu cầu chỉnh công</p>
          </div>
        </div>
      ) : null}

      <Card title={data ? `Chi tiết theo ngày (${days.length})` : "Chi tiết theo ngày"}>
        {data === null && !error ? (
          <LoadingRows count={5} />
        ) : days.length === 0 ? (
          <Empty>Không có ngày nào khớp với bộ lọc hiện tại.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  <th>Tổng thời gian</th>
                  <th>Địa điểm</th>
                  <th>Trạng thái</th>
                  <th>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => {
                  const meta = DAY_STATUS[day.status as DayStatus];
                  return (
                    <tr key={day.work_date}>
                      <td data-label="Ngày">
                        <p className="event__label">{dayLabel(day.work_date)}</p>
                        {day.scheduled_start ? (
                          <p className="event__meta">
                            Ca {shortTime(day.scheduled_start)}–{shortTime(day.scheduled_end)}
                          </p>
                        ) : null}
                      </td>
                      <td data-label="Check-in" className="numeric">{clockOf(day.check_in)}</td>
                      <td data-label="Check-out" className="numeric">{clockOf(day.check_out)}</td>
                      <td data-label="Tổng thời gian" className="numeric">{formatMinutes(day.worked_minutes)}</td>
                      <td data-label="Địa điểm">{day.location_name ?? "—"}</td>
                      <td data-label="Trạng thái">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {day.rejected_count > 0 ? (
                          <p className="event__meta">{day.rejected_count} lượt bị từ chối</p>
                        ) : null}
                      </td>
                      <td data-label="Chi tiết">
                        <Button size="sm" variant="secondary" onClick={() => void openDetail(day.work_date)}>
                          Xem
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openDay ? (
        <Dialog title={`Chi tiết ngày ${dayLabel(openDay)}`} onClose={() => setOpenDay(null)}>
          <div className="stack">
            {dayError ? <Alert tone="danger">{dayError}</Alert> : null}
            {dayEvents === null && !dayError ? (
              <LoadingRows count={3} />
            ) : dayEvents && dayEvents.length === 0 ? (
              <Empty>Không có lượt nào trong ngày này.</Empty>
            ) : (
              (dayEvents ?? []).map((event) => (
                <div className="event" key={event.id}>
                  <div>
                    <p className="event__label">
                      {event.event_type === "CHECK_IN" ? "Check-in" : "Check-out"} · {event.location_name}
                    </p>
                    <p className="event__meta">
                      {formatDateTime(event.server_time)} · cách {formatDistance(event.distance_meters)} · độ chính xác ±
                      {event.gps_accuracy_meters.toFixed(0)} m
                    </p>
                    {event.failure_code ? (
                      <p className="event__meta" style={{ color: "var(--color-danger)" }}>
                        {describeFailure(event.failure_code)}
                      </p>
                    ) : null}
                    {event.reason ? <p className="event__meta">Lý do: {event.reason}</p> : null}
                  </div>
                  <Badge
                    tone={
                      event.status === "SUCCESS"
                        ? "success"
                        : event.status === "WARNING_CONFIRMED"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {event.status === "SUCCESS"
                      ? "Hợp lệ"
                      : event.status === "WARNING_CONFIRMED"
                        ? "Hợp lệ có lý do"
                        : event.status === "BLOCKED"
                          ? "Ngoài phạm vi"
                          : "Không hợp lệ"}
                  </Badge>
                </div>
              ))
            )}

            <DataList
              rows={[
                { key: "Ngày", value: openDay },
                {
                  key: "Tổng thời gian",
                  value: formatMinutes(data?.days.find((d) => d.work_date === openDay)?.worked_minutes ?? null),
                },
              ]}
            />

            <Button variant="secondary" onClick={() => router.push(`/corrections?date=${openDay}`)} block>
              Gửi yêu cầu chỉnh công cho ngày này
            </Button>
          </div>
        </Dialog>
      ) : null}
    </AppShell>
  );
}

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
  pairDuration,
  pairSessions,
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
  { value: "", label: "Tất cả các ngày" },
  { value: "VALID", label: "Ngày bình thường" },
  { value: "LATE", label: "Ngày đến muộn" },
  { value: "MISSING_CHECK_OUT", label: "Ngày quên bấm giờ ra" },
  { value: "INVALID", label: "Ngày chấm công không thành" },
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
          <h1 className="page-title">Bảng công của bạn</h1>
          <p className="page-lead">Mỗi ngày bạn đi làm, làm bao lâu và có gì cần lưu ý.</p>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Card className="filter-card">
        <div className="filters-bar filters-bar--compact">
          <SelectField label="Xem" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="month">Cả tháng</option>
            <option value="range">Khoảng ngày tự chọn</option>
          </SelectField>

          {mode === "month" ? (
            // The native month value ("September 2026") needs more room than a
            // half-width cell gives it on a phone.
            <div className="filters-bar__wide">
              <Field label="Tháng" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          ) : (
            <>
              <Field label="Từ ngày" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Field label="Đến ngày" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          )}

          <SelectField label="Lọc theo" value={status} onChange={(e) => setStatus(e.target.value)}>
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
              <span className="tile__label">Số ngày đi làm</span>
            </div>
            <p className="tile__value">{data.summary.days_present}</p>
            <p className="tile__foot">Trong khoảng bạn đang xem</p>
          </div>
          <div className="tile">
            <div className="tile__head">
              <span className="tile__label">Tổng giờ làm</span>
            </div>
            <p className="tile__value">{Math.floor(data.summary.total_worked_minutes / 60)}
              <span className="tile__of">giờ</span>
            </p>
            <p className="tile__foot">{formatMinutes(data.summary.total_worked_minutes)}</p>
          </div>
          <div className={`tile ${data.summary.days_late > 0 ? "tile--warning" : ""}`}>
            <div className="tile__head">
              <span className="tile__label">Số buổi đến muộn</span>
            </div>
            <p className="tile__value">{data.summary.days_late}</p>
            <p className="tile__foot">So với giờ vào đã quy định</p>
          </div>
          <div className={`tile ${data.summary.days_missing_check_out > 0 ? "tile--warning" : ""}`}>
            <div className="tile__head">
              <span className="tile__label">Quên bấm giờ ra</span>
            </div>
            <p className="tile__value">{data.summary.days_missing_check_out}</p>
            <p className="tile__foot">Bạn có thể xin sửa lại</p>
          </div>
        </div>
      ) : null}

      <Card title={data ? `Từng ngày (${days.length})` : "Từng ngày"}>
        {data === null && !error ? (
          <LoadingRows count={5} />
        ) : days.length === 0 ? (
          <Empty>Không có ngày nào trong khoảng bạn chọn.</Empty>
        ) : (
          <ul className="daylist">
            {days.map((day) => {
              const meta = DAY_STATUS[day.status as DayStatus];
              return (
                <li className="daylist__row" key={day.work_date}>
                  <div className="daylist__main">
                    <p className="daylist__date">{dayLabel(day.work_date)}</p>
                    <p className="daylist__times">
                      Vào {clockOf(day.check_in)} · Ra {clockOf(day.check_out)}
                      {day.worked_minutes ? ` · làm ${formatMinutes(day.worked_minutes)}` : ""}
                    </p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => void openDetail(day.work_date)}>
                    Chi tiết
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {openDay ? (
        <Dialog title={dayLabel(openDay)} onClose={() => setOpenDay(null)}>
          <div className="stack">
            {dayError ? <Alert tone="danger">{dayError}</Alert> : null}
            {dayEvents === null && !dayError ? (
              <LoadingRows count={3} />
            ) : dayEvents && dayEvents.length === 0 ? (
              <Empty>Ngày này bạn không chấm công lần nào.</Empty>
            ) : (
              pairSessions(dayEvents ?? []).map((pair) => {
                const minutes = pairDuration(pair);
                return (
                  <div className="session" key={pair.key}>
                    <div className="session__leg">
                      <span className="session__tag session__tag--in">Vào</span>
                      <div className="session__body">
                        <p className="session__time">{clockOf(pair.checkIn?.server_time ?? null)}</p>
                        <p className="session__meta">
                          {pair.checkIn
                            ? `${pair.checkIn.location_name} · cách ${formatDistance(pair.checkIn.distance_meters)}`
                            : "Không có lượt vào"}
                        </p>
                      </div>
                    </div>

                    <div className="session__leg">
                      <span className="session__tag session__tag--out">Ra</span>
                      <div className="session__body">
                        <p className="session__time">{clockOf(pair.checkOut?.server_time ?? null)}</p>
                        <p className="session__meta">
                          {pair.checkOut
                            ? pair.checkOut.reason
                              ? pair.checkOut.reason
                              : `${pair.checkOut.location_name} · cách ${formatDistance(pair.checkOut.distance_meters)}`
                            : "Chưa bấm giờ ra"}
                        </p>
                      </div>
                    </div>

                    <div className="session__total">
                      {minutes !== null ? (
                        <Badge tone="success">Làm {formatMinutes(minutes)}</Badge>
                      ) : (
                        <Badge tone="warning">Chưa khép buổi</Badge>
                      )}
                    </div>

                    {pair.rejected.length > 0 ? (
                      <ul className="session__rejected">
                        {pair.rejected.map((event) => (
                          <li key={event.id}>
                            {clockOf(event.server_time)} — lần thử không thành:{" "}
                            {describeFailure(event.failure_code) ?? "không rõ lý do"}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })
            )}

            {(() => {
              const day = data?.days.find((d) => d.work_date === openDay);
              if (!day) {
                return null;
              }
              // Only what the session cards above do not already say.
              return (
                <DataList
                  rows={[
                    ...(day.scheduled_start
                      ? [
                          {
                            key: "Giờ quy định",
                            value: `${shortTime(day.scheduled_start)} – ${shortTime(day.scheduled_end)}`,
                          },
                        ]
                      : []),
                    {
                      key: "Kết quả ngày này",
                      value: <Badge tone={DAY_STATUS[day.status].tone}>{DAY_STATUS[day.status].label}</Badge>,
                    },
                  ]}
                />
              );
            })()}

            <Button variant="secondary" onClick={() => router.push(`/corrections?date=${openDay}`)} block>
              Xin sửa lại công ngày này
            </Button>
          </div>
        </Dialog>
      ) : null}
    </AppShell>
  );
}

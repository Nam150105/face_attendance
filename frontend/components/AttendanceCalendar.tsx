"use client";

import { useEffect, useMemo, useState } from "react";

import { Dialog } from "./Dialog";
import { Alert, Badge, Button, Empty, LoadingRows } from "./ui";
import { api } from "../lib/api";
import { describeError } from "../lib/messages";
import { describeMinutes } from "../lib/member";
import type { AttendanceCalendar as CalendarData, CalendarDay, CalendarDayStatus, CalendarPerson } from "../lib/types";

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

const STATUS: Record<CalendarDayStatus, { dot: string; label: string }> = {
  ON_TIME: { dot: "var(--color-success)", label: "Đúng giờ" },
  LATE: { dot: "var(--color-danger)", label: "Đi muộn" },
  OPEN: { dot: "var(--color-warning)", label: "Chưa chấm ra" },
  REJECTED: { dot: "var(--text-muted)", label: "Không chấm được" },
};

function monthKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function initials(person: CalendarPerson): string {
  const source = person.member_name?.trim() || person.member_email.split("@")[0] || "?";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[words.length - 2][0] + words[words.length - 1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

function shortTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

/** Monday-first grid, padded so week rows always line up under the headings. */
function buildGrid(month: string): (string | null)[] {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(year, monthIndex - 1, 1);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

/** The badge says whether they turned up; this says how the day went. */
function timing(person: CalendarPerson): string {
  if (person.status === "REJECTED") {
    return `${person.rejected} lần bị từ chối`;
  }
  const notes: string[] = [];
  if (person.minutes_late > 0) {
    notes.push(`Muộn ${describeMinutes(person.minutes_late)}`);
  } else {
    notes.push("Đúng giờ");
  }
  if (person.minutes_early_leave > 0) {
    notes.push(`về sớm ${describeMinutes(person.minutes_early_leave)}`);
  } else if (!person.check_out) {
    notes.push("chưa chấm ra");
  }
  return notes.join(", ");
}

export function AttendanceCalendar({ search, refreshToken = 0 }: { search: string; refreshToken?: number }) {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<CalendarDay | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    api
      .managerAttendanceCalendar(month)
      .then((result) => {
        if (live) {
          setData(result);
          setError(null);
        }
      })
      .catch((cause) => {
        if (live) {
          setError(describeError(cause));
        }
      });
    return () => {
      live = false;
    };
  }, [month, refreshToken]);

  const needle = search.trim().toLowerCase();
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarPerson[]>();
    for (const day of data?.days ?? []) {
      const people = needle
        ? day.people.filter(
            (person) =>
              (person.member_name ?? "").toLowerCase().includes(needle) ||
              person.member_email.toLowerCase().includes(needle),
          )
        : day.people;
      if (people.length > 0) {
        map.set(day.date, people);
      }
    }
    return map;
  }, [data, needle]);

  const visible = useMemo(() => [...byDate.values()].flat(), [byDate]);
  const counters = needle
    ? {
        events: visible.length,
        attended: visible.filter((person) => person.check_in).length,
        late: visible.filter((person) => person.minutes_late > 0).length,
        open_sessions: visible.filter((person) => person.check_in && !person.check_out).length,
      }
    : data?.summary;

  const [year, monthIndex] = month.split("-").map(Number);
  const today = new Date();
  const todayKey = `${monthKey(today)}-${String(today.getDate()).padStart(2, "0")}`;

  function shiftMonth(step: number) {
    setMonth(monthKey(new Date(year, monthIndex - 1 + step, 1)));
  }

  return (
    <div className="stack">
      <div className="calendar-bar">
        <div className="calendar-nav">
          <Button variant="ghost" size="sm" onClick={() => shiftMonth(-1)} aria-label="Tháng trước">
            ‹
          </Button>
          <span className="calendar-nav__label">
            Tháng {monthIndex}/{year}
          </span>
          <Button variant="ghost" size="sm" onClick={() => shiftMonth(1)} aria-label="Tháng sau">
            ›
          </Button>
        </div>

        {counters ? (
          <div className="calendar-counters">
            <span>
              <strong>{counters.events}</strong> lượt
            </span>
            <span>
              <strong>{counters.attended}</strong> ngày công
            </span>
            <span className={counters.late > 0 ? "is-late" : undefined}>
              <strong>{counters.late}</strong> lượt muộn
            </span>
            <span className={counters.open_sessions > 0 ? "is-open" : undefined}>
              <strong>{counters.open_sessions}</strong> chưa chấm ra
            </span>
          </div>
        ) : null}

        <div className="calendar-legend">
          {(["ON_TIME", "OPEN", "LATE"] as CalendarDayStatus[]).map((key) => (
            <span key={key}>
              <i style={{ background: STATUS[key].dot }} aria-hidden="true" />
              {STATUS[key].label}
            </span>
          ))}
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {data === null && !error ? (
        <LoadingRows count={6} />
      ) : (
        <div className="calendar" role="grid" aria-label={`Chấm công tháng ${monthIndex}/${year}`}>
          {WEEKDAYS.map((label) => (
            <div className="calendar__heading" key={label} role="columnheader">
              {label}
            </div>
          ))}
          {buildGrid(month).map((date, index) => {
            if (date === null) {
              return <div className="calendar__cell calendar__cell--empty" key={`pad-${index}`} aria-hidden="true" />;
            }
            const people = byDate.get(date) ?? [];
            const dayNumber = Number(date.slice(-2));
            return (
              <button
                type="button"
                key={date}
                className={`calendar__cell${date === todayKey ? " is-today" : ""}${people.length ? "" : " is-quiet"}`}
                onClick={() => people.length > 0 && setOpenDay({ date, people })}
                disabled={people.length === 0}
                aria-label={`Ngày ${dayNumber}: ${people.length} lượt`}
              >
                <span className="calendar__date">{dayNumber}</span>
                {people.length > 0 ? <span className="calendar__count">{people.length} lượt</span> : null}
                <span className="calendar__people">
                  {people.slice(0, 4).map((person) => (
                    <span
                      className="calendar__chip"
                      key={person.member_id}
                      title={`${person.member_name ?? person.member_email} · ${STATUS[person.status].label}`}
                    >
                      {initials(person)}
                      <i style={{ background: STATUS[person.status].dot }} aria-hidden="true" />
                    </span>
                  ))}
                  {people.length > 4 ? <span className="calendar__more">+{people.length - 4}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {openDay ? (
        <Dialog
          title={`Chấm công ngày ${openDay.date.split("-").reverse().join("/")}`}
          onClose={() => setOpenDay(null)}
        >
          <p className="page-lead">{openDay.people.length} lượt</p>
          {openDay.people.length === 0 ? (
            <Empty>Không có ai chấm công hôm này.</Empty>
          ) : (
            <div className="stack stack--tight">
              {openDay.people.map((person) => (
                <div className="day-row" key={person.member_id}>
                  <span className="calendar__chip calendar__chip--lg">
                    {initials(person)}
                    <i style={{ background: STATUS[person.status].dot }} aria-hidden="true" />
                  </span>
                  <div className="day-row__body">
                    <p className="person__name">{person.member_name ?? person.member_email}</p>
                    <p className="event__meta">
                      Vào {shortTime(person.check_in)} · Ra {shortTime(person.check_out)}
                      {person.location_name ? ` · ${person.location_name}` : ""}
                    </p>
                  </div>
                  <div className="day-row__status">
                    <Badge tone={person.status === "REJECTED" ? "danger" : "success"}>
                      {person.status === "REJECTED" ? "Không vào được" : "Đi làm"}
                    </Badge>
                    <p className="event__meta" style={{ color: STATUS[person.status].dot }}>
                      {timing(person)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Dialog>
      ) : null}
    </div>
  );
}

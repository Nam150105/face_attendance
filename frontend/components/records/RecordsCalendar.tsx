"use client";

import type { CalendarPerson } from "../../lib/types";
import { DAY_STATUS, buildGrid, localDateKey, summariseDay } from "../../lib/records";

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/**
 * The month as a wall calendar. Each day says how many came, how many were
 * late, how many have not left, and shows one dot per person in the colour of
 * their day — enough to spot the bad day from across the room, and one click
 * from the names.
 */
export function RecordsCalendar({
  month,
  byDate,
  selected,
  onPick,
}: {
  month: string;
  byDate: Map<string, CalendarPerson[]>;
  selected: string | null;
  onPick: (date: string) => void;
}) {
  const todayKey = localDateKey(new Date());
  return (
    <div className="rcal" role="grid" aria-label={`Lịch tháng ${month}`}>
      {WEEKDAYS.map((label, index) => (
        <div key={label} className={`rcal__head${index >= 5 ? " is-weekend" : ""}`} role="columnheader">
          {label}
        </div>
      ))}
      {buildGrid(month).map((date, index) => {
        if (!date) {
          return <div key={`pad-${index}`} className="rcal__cell rcal__cell--off" aria-hidden="true" />;
        }
        const people = byDate.get(date) ?? [];
        const summary = summariseDay(people);
        const dayNumber = Number(date.slice(-2));
        const events = people.reduce(
          (total, person) => total + (person.check_in ? 1 : 0) + (person.check_out ? 1 : 0) + person.rejected,
          0,
        );
        return (
          <button
            type="button"
            key={date}
            role="gridcell"
            className={`rcal__cell${date === todayKey ? " is-today" : ""}${date === selected ? " is-picked" : ""}`}
            aria-pressed={date === selected}
            aria-label={`Ngày ${dayNumber}: ${summary.people} người đi làm, ${summary.late} muộn, ${summary.open} chưa ra ca`}
            onClick={() => onPick(date)}
          >
            <span className="rcal__top">
              <span className="rcal__date">{dayNumber}</span>
              {events > 0 ? <span className="rcal__count">{events} lượt</span> : null}
            </span>
            {people.length > 0 ? (
              <span className="rcal__line">
                {summary.people > 0 ? (
                  <span>
                    <strong>{summary.people}</strong> người
                  </span>
                ) : null}
                {summary.late > 0 ? (
                  <span className="is-late">
                    · <strong>{summary.late}</strong> muộn
                  </span>
                ) : null}
                {summary.open > 0 ? (
                  <span className="is-open">
                    · <strong>{summary.open}</strong> chưa ra ca
                  </span>
                ) : null}
                {summary.refused > 0 ? (
                  <span className="is-refused">
                    · <strong>{summary.refused}</strong> bị từ chối
                  </span>
                ) : null}
              </span>
            ) : null}
            {people.length > 0 ? (
              <span className="rcal__dots" aria-hidden="true">
                {people.slice(0, 12).map((person) => (
                  <i
                    key={person.member_id}
                    className={person.status === "REJECTED_FACE" || person.status === "REJECTED_PLACE" ? "is-ring" : undefined}
                    style={{ background: DAY_STATUS[person.status].dot, borderColor: DAY_STATUS[person.status].dot }}
                    title={`${person.member_name ?? person.member_email} · ${DAY_STATUS[person.status].label}`}
                  />
                ))}
                {people.length > 12 ? <span className="rcal__more">+{people.length - 12}</span> : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

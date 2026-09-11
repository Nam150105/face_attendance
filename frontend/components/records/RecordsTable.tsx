"use client";

import type { CalendarPerson } from "../../lib/types";
import { DAY_STATUS, clock, initials, presenceOf, shortDate } from "../../lib/records";
import { Badge, Empty } from "../ui";

/**
 * The same month as rows: one line per person per day, newest first. For
 * checking a claim ("I was in on the 7th") a list beats a calendar.
 */
export function RecordsTable({
  byDate,
  onPick,
}: {
  byDate: Map<string, CalendarPerson[]>;
  onPick: (date: string, memberId: string) => void;
}) {
  const rows = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .flatMap(([date, people]) => people.map((person) => ({ date, person })));

  if (rows.length === 0) {
    return <Empty>Tháng này chưa có lượt chấm công nào.</Empty>;
  }

  return (
    <div className="table-wrap">
      <table className="table table--records">
        <thead>
          <tr>
            <th>Ngày</th>
            <th>Thành viên</th>
            <th>Vào</th>
            <th>Ra</th>
            <th>Có mặt</th>
            <th>Nơi</th>
            <th>Tình trạng</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ date, person }) => (
            <tr
              key={`${date}-${person.member_id}`}
              className="is-clickable"
              onClick={() => onPick(date, person.member_id)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPick(date, person.member_id);
                }
              }}
            >
              <td data-label="Ngày" className="mono">
                {shortDate(date)}
              </td>
              <td data-label="Thành viên">
                <span className="who">
                  <span className="avatar avatar--sm" aria-hidden="true">
                    {initials(person.member_name, person.member_email)}
                  </span>
                  <span className="who__text">
                    <span className="who__name">{person.member_name ?? person.member_email}</span>
                    {person.member_name ? <span className="who__meta">{person.member_email}</span> : null}
                  </span>
                </span>
              </td>
              <td data-label="Vào" className="mono">
                {clock(person.check_in)}
                {person.minutes_late > 0 ? <span className="table__note is-late"> +{person.minutes_late}&#39;</span> : null}
              </td>
              <td data-label="Ra" className="mono">
                {clock(person.check_out)}
                {person.minutes_early_leave > 0 ? (
                  <span className="table__note is-open"> −{person.minutes_early_leave}&#39;</span>
                ) : null}
              </td>
              <td data-label="Có mặt">{person.check_in ? presenceOf(person) : "—"}</td>
              <td data-label="Nơi">{person.location_name ?? "—"}</td>
              <td data-label="Tình trạng">
                <Badge tone={DAY_STATUS[person.status].tone}>{DAY_STATUS[person.status].label}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

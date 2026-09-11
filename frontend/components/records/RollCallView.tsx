"use client";

import { useEffect, useState } from "react";

import { api } from "../../lib/api";
import { describeError } from "../../lib/messages";
import { ROLL_STATUS, clock, initials, longDate, timingPill } from "../../lib/records";
import type { RollCall } from "../../lib/types";
import { Alert, Badge, Empty, LoadingRows } from "../ui";

/**
 * Everybody who should be here today, and whether they are.
 *
 * The calendar only knows about people who did something. The roll call
 * starts from the roster, so the person who never turned up is the first
 * line rather than a gap nobody notices.
 */
export function RollCallView({
  date,
  refreshToken,
  search,
  onPick,
}: {
  date: string;
  refreshToken: number;
  search: string;
  onPick: (memberId: string) => void;
}) {
  const [data, setData] = useState<RollCall | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    api
      .rollCall(date)
      .then((result) => {
        if (live) {
          setData(result);
          setError(null);
        }
      })
      .catch((cause) => {
        if (live) {
          setError(describeError(cause));
          setData({ date, summary: { expected: 0, present: 0, late: 0, open: 0, absent: 0 }, people: [] });
        }
      });
    return () => {
      live = false;
    };
  }, [date, refreshToken]);

  const needle = search.trim().toLowerCase();
  const people = (data?.people ?? []).filter(
    (person) =>
      !needle ||
      (person.member_name ?? "").toLowerCase().includes(needle) ||
      person.member_email.toLowerCase().includes(needle),
  );

  return (
    <div className="roll">
      <div className="roll__head">
        <h2 className="roll__title">{longDate(date)}</h2>
        {data ? (
          <div className="roll__summary">
            <span>
              <strong>{data.summary.present}</strong>/{data.summary.expected} có mặt
            </span>
            <span className={data.summary.late > 0 ? "is-late" : undefined}>
              <strong>{data.summary.late}</strong> muộn
            </span>
            <span className={data.summary.open > 0 ? "is-open" : undefined}>
              <strong>{data.summary.open}</strong> đang làm
            </span>
            <span className={data.summary.absent > 0 ? "is-refused" : undefined}>
              <strong>{data.summary.absent}</strong> chưa chấm
            </span>
          </div>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {data === null ? (
        <LoadingRows count={6} />
      ) : people.length === 0 ? (
        <Empty>{needle ? "Không có ai khớp với từ tìm." : "Chưa có ai trong nhóm để điểm danh."}</Empty>
      ) : (
        <ul className="roll__list">
          {people.map((person) => {
            const pill = person.status === "ABSENT" ? ROLL_STATUS.ABSENT : timingPill(person);
            return (
              <li key={person.member_id}>
                <button
                  type="button"
                  className="person-row"
                  onClick={() => onPick(person.member_id)}
                  disabled={person.status === "ABSENT"}
                >
                  <span className="avatar" aria-hidden="true">
                    {initials(person.member_name, person.member_email)}
                    <i style={{ background: ROLL_STATUS[person.status].dot }} />
                  </span>
                  <span className="person-row__body">
                    <span className="person-row__name">{person.member_name ?? person.member_email}</span>
                    <span className="person-row__meta">
                      {person.status === "ABSENT" ? (
                        person.team_name ?? person.member_email
                      ) : (
                        <>
                          Vào <strong>{clock(person.check_in)}</strong> ·{" "}
                          {person.check_out ? (
                            <>
                              Ra <strong>{clock(person.check_out)}</strong>
                            </>
                          ) : (
                            <span className="is-open">chưa ra ca</span>
                          )}
                          {person.location_name ? ` · ${person.location_name}` : ""}
                        </>
                      )}
                    </span>
                  </span>
                  <Badge tone={pill.tone}>{pill.label}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

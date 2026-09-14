"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Drawer } from "../../../components/Drawer";
import { ManagerShell } from "../../../components/ManagerShell";
import { PersonPanel } from "../../../components/records/PersonPanel";
import { RecordsCalendar } from "../../../components/records/RecordsCalendar";
import { RecordsTable } from "../../../components/records/RecordsTable";
import { RollCallView } from "../../../components/records/RollCallView";
import { Alert, Badge, Button, Empty, LoadingRows } from "../../../components/ui";
import { api } from "../../../lib/api";
import { describeError } from "../../../lib/messages";
import { usePermissions } from "../../../lib/permissions";
import {
  DAY_STATUS,
  clock,
  exportSessionsCsv,
  initials,
  localDateKey,
  longDate,
  monthKey,
  summariseDay,
  timingPill,
} from "../../../lib/records";

import type {
  AttendanceCalendar,
  CalendarPerson,
  DaySession,
  ManagerLocation,
} from "../../../lib/types";

const DAY_LIMIT = 200;

type View = "calendar" | "table" | "roll";

const VIEWS: { key: View; label: string; icon: string }[] = [
  {
    key: "calendar",
    label: "Lịch",
    icon: "▦",
  },
  {
    key: "table",
    label: "Bảng",
    icon: "☰",
  },
  {
    key: "roll",
    label: "Điểm danh",
    icon: "✓",
  },
];

export default function ManagerAttendancePage() {
  const may = usePermissions("records");

  const [view, setView] = useState<View>("calendar");
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [search, setSearch] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const [data, setData] = useState<AttendanceCalendar | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [day, setDay] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DaySession[] | null>(null);

  const [person, setPerson] = useState<{
    memberId: string;
    attemptId: string | null;
  } | null>(null);

  const [locations, setLocations] = useState<ManagerLocation[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  /*
   * Luôn hiển thị các lượt bị từ chối.
   * Ví dụ: một ngày chỉ có 3 lần nhận diện khuôn mặt thất bại
   * vẫn phải xuất hiện trên lịch.
   */
  const includeInvalid = true;

  // ------------------------------------------------------------
  // Load calendar
  // ------------------------------------------------------------

  useEffect(() => {
    let live = true;

    setData(null);

    api
      .managerAttendanceCalendar(month, includeInvalid)
      .then((result) => {
        if (!live) return;

        setData(result);
        setError(null);
      })
      .catch((cause) => {
        if (!live) return;

        setError(describeError(cause));
      });

    return () => {
      live = false;
    };
  }, [month, includeInvalid, refreshToken]);

  // ------------------------------------------------------------
  // Load current user + locations
  // ------------------------------------------------------------

  useEffect(() => {
    api
      .me()
      .then((me) => {
        setIsAdmin(me.role === "SUPER_ADMIN");
      })
      .catch(() => {
        setIsAdmin(false);
      });

    api
      .managerLocations()
      .then(setLocations)
      .catch(() => {
        setLocations([]);
      });
  }, []);

  // ------------------------------------------------------------
  // Load sessions of selected day
  // ------------------------------------------------------------

  const loadDay = useCallback(async () => {
    if (!day) return;

    setSessions(null);

    try {
      const result = await api.managerAttendanceSessions({
        date_from: day,
        date_to: day,
        include_invalid: includeInvalid,
        limit: DAY_LIMIT,
        offset: 0,
      });

      setSessions(result.items);
    } catch (cause) {
      setError(describeError(cause));
      setSessions([]);
    }
  }, [day, includeInvalid]);

  useEffect(() => {
    void loadDay();
  }, [loadDay, refreshToken]);

  // ------------------------------------------------------------
  // Search
  // ------------------------------------------------------------

  const needle = search.trim().toLowerCase();

  const matches = useCallback(
    (item: {
      member_name: string | null;
      member_email: string;
    }) => {
      if (!needle) return true;

      return (
        (item.member_name ?? "").toLowerCase().includes(needle) ||
        item.member_email.toLowerCase().includes(needle)
      );
    },
    [needle],
  );

  // ------------------------------------------------------------
  // Calendar data filtered by search
  // ------------------------------------------------------------

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarPerson[]>();

    for (const item of data?.days ?? []) {
      const people = item.people.filter(matches);

      if (people.length > 0) {
        map.set(item.date, people);
      }
    }

    return map;
  }, [data, matches]);

  // ------------------------------------------------------------
  // Counters
  // ------------------------------------------------------------

  const counters = useMemo(() => {
    const all = [...byDate.values()].flat();

    const summary = summariseDay(all);

    const events = all.reduce(
      (total, person) =>
        total +
        (person.check_in ? 1 : 0) +
        (person.check_out ? 1 : 0) +
        person.rejected,
      0,
    );

    return {
      events,
      ...summary,
    };
  }, [byDate]);

  // ------------------------------------------------------------
  // Month navigation
  // ------------------------------------------------------------

  const [year, monthIndex] = month.split("-").map(Number);

  function shiftMonth(step: number) {
    setMonth(
      monthKey(
        new Date(
          year,
          monthIndex - 1 + step,
          1,
        ),
      ),
    );
  }

  function refresh() {
    setRefreshToken((value) => value + 1);
  }

  // ------------------------------------------------------------
  // Drawer
  // ------------------------------------------------------------

  function openDay(date: string) {
    setPerson(null);
    setDay(date);
  }

  function openPerson(
    date: string,
    memberId: string,
    attemptId: string | null = null,
  ) {
    setDay(date);
    setPerson({
      memberId,
      attemptId,
    });
  }

  function closeDrawer() {
    setPerson(null);
    setDay(null);
  }

  // ------------------------------------------------------------
  // Selected person / day
  // ------------------------------------------------------------

  const shownSessions = (sessions ?? []).filter(matches);

  const current = person
    ? (
        shownSessions.find(
          (row) => row.member_id === person.memberId,
        ) ??
        (sessions ?? []).find(
          (row) => row.member_id === person.memberId,
        ) ??
        null
      )
    : null;

  const daySummary = summariseDay(shownSessions);
  const today = localDateKey(new Date());

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------

  return (
    <ManagerShell>
      <div className="records">

        {/* =====================================================
            HEADER
        ====================================================== */}

        <header className="records__bar">

          {/* Month navigation */}
          <div
            className="records__nav"
            role="group"
            aria-label="Chọn tháng"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => shiftMonth(-1)}
              aria-label="Tháng trước"
            >
              ‹
            </Button>

            <span className="records__month">
              Tháng {monthIndex}/{year}
            </span>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => shiftMonth(1)}
              aria-label="Tháng sau"
            >
              ›
            </Button>
          </div>

          {/* Counters */}
          <div className="records__header">
            <div
              className="records__counters"
              aria-live="polite"
            >
              <span>
                <strong>{counters.events}</strong> lượt
              </span>

              <span>
                <strong>{counters.people}</strong> người đi làm
              </span>

              <span
                className={
                  counters.open > 0
                    ? "is-open"
                    : undefined
                }
              >
                <strong>{counters.open}</strong> chưa ra ca
              </span>

              <span
                className={
                  counters.late > 0
                    ? "is-late"
                    : undefined
                }
              >
                <strong>{counters.late}</strong> đi muộn
              </span>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={refresh}
              aria-label="Làm mới"
              title="Làm mới"
            >
              ⟳
            </Button>
          </div>

          {/* Search + view switcher */}
          <div className="records__tools">

            <label className="records__search">
              <span className="visually-hidden">
                Tìm theo tên hoặc email
              </span>

              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle
                  cx="11"
                  cy="11"
                  r="7"
                />

                <path d="m20 20-3.5-3.5" />
              </svg>

              <input
                className="input"
                placeholder="Tìm theo tên hoặc email…"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
              />
            </label>

            <div
              className="segmented"
              role="tablist"
              aria-label="Cách xem"
            >
              {VIEWS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={view === item.key}
                  className={
                    view === item.key
                      ? "is-active"
                      : undefined
                  }
                  onClick={() =>
                    setView(item.key)
                  }
                >
                  <span aria-hidden="true">
                    {item.icon}
                  </span>{" "}
                  {item.label}
                </button>
              ))}
            </div>

          </div>
        </header>

        {/* =====================================================
            LEGEND
        ====================================================== */}

        <div className="records__sub">
          <div className="records__legend">

            {(
              [
                "ON_TIME",
                "OPEN",
                "LATE",
              ] as const
            ).map((key) => (
              <span key={key}>
                <i
                  style={{
                    background:
                      DAY_STATUS[key].dot,
                  }}
                  aria-hidden="true"
                />

                {DAY_STATUS[key].label}
              </span>
            ))}

            {(
              [
                "REJECTED_FACE",
                "REJECTED_PLACE",
              ] as const
            ).map((key) => (
              <span key={key}>
                <i
                  className="is-ring"
                  style={{
                    borderColor:
                      DAY_STATUS[key].dot,
                  }}
                  aria-hidden="true"
                />

                {DAY_STATUS[key].label}
              </span>
            ))}

          </div>
        </div>

        {/* =====================================================
            ERROR
        ====================================================== */}

        {error ? (
          <Alert tone="danger">
            {error}
          </Alert>
        ) : null}

        {/* =====================================================
            MAIN CONTENT
        ====================================================== */}

        {view === "roll" ? (

          <RollCallView
            date={today}
            refreshToken={refreshToken}
            search={search}
            onPick={(memberId) =>
              openPerson(
                today,
                memberId,
              )
            }
          />

        ) : data === null ? (

          <LoadingRows count={6} />

        ) : view === "calendar" ? (

          <RecordsCalendar
            month={month}
            byDate={byDate}
            selected={day}
            onPick={openDay}
          />

        ) : (

          <RecordsTable
            byDate={byDate}
            onPick={openPerson}
          />

        )}

      </div>

      {/* =======================================================
          DRAWER
      ======================================================== */}

      {day ? (
        <Drawer
          title={
            person && current
              ? current.member_name ??
                current.member_email
              : `Chấm công ngày ${day
                  .split("-")
                  .reverse()
                  .join("/")}`
          }

          subtitle={
            person && current ? (
              current.member_email
            ) : sessions ? (
              <>
                {longDate(day).split(",")[0]} ·{" "}

                <strong>
                  {shownSessions.reduce(
                    (total, session) =>
                      total +
                      (session.check_in ? 1 : 0) +
                      (session.check_out ? 1 : 0),
                    0,
                  )}
                </strong>{" "}
                lượt ·{" "}

                <strong>
                  {daySummary.people}
                </strong>{" "}
                người

                {daySummary.late > 0 ? (
                  <>
                    {" "}·{" "}
                    <span className="is-late">
                      <strong>
                        {daySummary.late}
                      </strong>{" "}
                      muộn
                    </span>
                  </>
                ) : null}

                {daySummary.open > 0 ? (
                  <>
                    {" "}·{" "}
                    <span className="is-open">
                      <strong>
                        {daySummary.open}
                      </strong>{" "}
                      chưa ra ca
                    </span>
                  </>
                ) : null}
              </>
            ) : undefined
          }

          onClose={closeDrawer}

          onBack={
            person
              ? () => setPerson(null)
              : undefined
          }

          header={
            person && current ? (
              <div className="person-head">

                <span
                  className="avatar avatar--lg"
                  aria-hidden="true"
                >
                  {initials(
                    current.member_name,
                    current.member_email,
                  )}
                </span>

                <div className="person-head__text">
                  <h2 className="drawer__title">
                    {current.member_name ??
                      current.member_email}
                  </h2>

                  <p className="drawer__subtitle">
                    {current.member_email}
                  </p>
                </div>

                <Badge
                  tone={
                    current.check_in
                      ? timingPill(current).tone
                      : DAY_STATUS[
                          current.status
                        ].tone
                  }
                >
                  {current.check_in
                    ? timingPill(current).label
                    : DAY_STATUS[
                        current.status
                      ].label}
                </Badge>

              </div>
            ) : undefined
          }
        >

          {/* ===================================================
              PERSON DETAIL
          ==================================================== */}

          {person ? (

            current ? (

              <PersonPanel
                session={current}
                attemptId={person.attemptId}
                locations={locations}
                canEdit={may.edit}
                canDelete={may.delete}
                isAdmin={isAdmin}
                onChanged={async () => {
                  refresh();
                }}
                onDeleted={async () => {
                  setPerson(null);
                  refresh();
                }}
              />

            ) : sessions === null ? (

              <LoadingRows count={4} />

            ) : (

              <Empty>
                Người này không có bản ghi
                trong ngày đã chọn.
              </Empty>

            )

          ) : sessions === null ? (

            <LoadingRows count={4} />

          ) : shownSessions.length === 0 ? (

            <Empty>
              Không ai chấm công ngày này.
            </Empty>

          ) : (

            <div className="stack stack--tight">

              {/* Export */}
              <div className="row is-right">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    exportSessionsCsv(
                      day,
                      shownSessions,
                    )
                  }
                >
                  Xuất CSV
                </Button>
              </div>

              {/* People */}
              <ul className="person-list">
                {shownSessions.map(
                  (session) => {
                    const pill =
                      timingPill(session);

                    const refusedOnly =
                      session.status ===
                        "REJECTED_FACE" ||
                      session.status ===
                        "REJECTED_PLACE";

                    const rowClass =
                      `person-row${
                        session.status ===
                        "REJECTED_FACE"
                          ? " person-row--face"
                          : session.status ===
                              "REJECTED_PLACE"
                            ? " person-row--place"
                            : ""
                      }`;

                    return (
                      <li
                        key={`${session.member_id}-${session.work_date}`}
                      >
                        <button
                          type="button"
                          className={rowClass}
                          onClick={() =>
                            openPerson(
                              session.work_date,
                              session.member_id,
                            )
                          }
                        >

                          <span
                            className="avatar"
                            aria-hidden="true"
                          >
                            {initials(
                              session.member_name,
                              session.member_email,
                            )}

                            <i
                              style={{
                                background:
                                  DAY_STATUS[
                                    session.status
                                  ].dot,
                              }}
                            />
                          </span>

                          <span className="person-row__body">

                            <span className="person-row__name">
                              {session.member_name ??
                                session.member_email}
                            </span>

                            <span className="person-row__meta">

                              {session.check_in ? (
                                <>
                                  Vào{" "}
                                  <strong>
                                    {clock(
                                      session.check_in,
                                    )}
                                  </strong>{" "}
                                  ·{" "}

                                  {session.check_out ? (
                                    <>
                                      Ra{" "}
                                      <strong>
                                        {clock(
                                          session.check_out,
                                        )}
                                      </strong>
                                    </>
                                  ) : (
                                    <span className="is-open">
                                      chưa ra ca
                                    </span>
                                  )}
                                </>
                              ) : (
                                <>
                                  {session.rejected}{" "}
                                  lần bị từ chối ·
                                  không có lượt hợp lệ
                                </>
                              )}

                              {session.location_name
                                ? ` · ${session.location_name}`
                                : ""}

                              {!refusedOnly &&
                              session.rejected > 0 ? (
                                <span className="is-late">
                                  {" "}·{" "}
                                  {session.rejected}{" "}
                                  lần bị từ chối
                                </span>
                              ) : null}

                            </span>
                          </span>

                          <Badge
                            tone={
                              refusedOnly
                                ? DAY_STATUS[
                                    session.status
                                  ].tone
                                : pill.tone
                            }
                          >
                            {refusedOnly
                              ? DAY_STATUS[
                                  session.status
                                ].label
                              : pill.label}
                          </Badge>

                        </button>
                      </li>
                    );
                  },
                )}
              </ul>

            </div>
          )}

        </Drawer>
      ) : null}

    </ManagerShell>
  );
}
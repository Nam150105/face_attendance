import unittest
from datetime import datetime, timedelta, timezone

from datetime import time

from app.services.attendance_days import day_status, local_today, session_is_open, shift_offset, work_date
from app.services.member_portal import LOCAL_ZONE, local_date


def utc(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


class DayStatusTests(unittest.TestCase):
    """
    One function decides how a day went, for every screen. Lateness itself is
    computed where the record is written (see test_hour_rules); here it is an
    input.
    """

    def test_only_a_face_refusal_names_the_face(self) -> None:
        self.assertEqual(day_status(None, None, 0, ["FACE_NOT_MATCHED"]), "REJECTED_FACE")

    def test_only_a_place_refusal_names_the_place(self) -> None:
        self.assertEqual(day_status(None, None, 0, ["OUTSIDE_ALLOWED_ZONE"]), "REJECTED_PLACE")

    def test_last_refusal_decides_when_there_were_several(self) -> None:
        # Two tries: first the GPS was off, then the face. The last one is the
        # one the person walked away with.
        self.assertEqual(
            day_status(None, None, 0, ["OUTSIDE_ALLOWED_ZONE", "FACE_NOT_MATCHED"]),
            "REJECTED_FACE",
        )

    def test_check_in_without_check_out_is_open(self) -> None:
        self.assertEqual(day_status(utc(2026, 9, 1, 1), None, 0, []), "OPEN")

    def test_complete_day_on_time(self) -> None:
        self.assertEqual(day_status(utc(2026, 9, 1, 1), utc(2026, 9, 1, 10), 0, []), "ON_TIME")

    def test_complete_day_late(self) -> None:
        self.assertEqual(day_status(utc(2026, 9, 1, 2), utc(2026, 9, 1, 10), 18, []), "LATE")

    def test_missing_check_out_wins_over_late(self) -> None:
        # A day can be both; the missing check-out is the one to act on, and
        # the minutes late are still on the row for whoever reads it.
        self.assertEqual(day_status(utc(2026, 9, 1, 3), None, 45, []), "OPEN")

    def test_a_refusal_on_a_day_that_was_worked_does_not_change_it(self) -> None:
        self.assertEqual(
            day_status(utc(2026, 9, 1, 1), utc(2026, 9, 1, 10), 0, ["FACE_NOT_MATCHED"]),
            "ON_TIME",
        )


class SessionWindowTests(unittest.TestCase):
    # Asia/Ho_Chi_Minh is UTC+7: local midnight is 17:00 UTC the day before.
    def test_open_while_it_is_still_the_same_local_day(self) -> None:
        now = utc(2026, 9, 1, 12)  # 19:00 local on the 1st
        self.assertTrue(session_is_open(utc(2026, 8, 31, 18), now))  # 01:00 local on the 1st

    def test_closed_once_local_midnight_has_passed(self) -> None:
        now = utc(2026, 9, 1, 12)
        self.assertFalse(session_is_open(utc(2026, 8, 31, 16), now))  # 23:00 local on the 31st

    def test_local_today_follows_the_organisation_timezone(self) -> None:
        self.assertEqual(local_today(utc(2026, 8, 31, 18)).isoformat(), "2026-09-01")


class NightShiftTests(unittest.TestCase):
    # 22:00–06:00: the off-duty gap runs 06:00→22:00, so the working day is
    # cut at 14:00 local, which is 07:00 UTC.
    OFFSET = shift_offset("NIGHT", time(22, 0), time(6, 0))

    def test_the_cut_is_the_middle_of_the_off_duty_gap(self) -> None:
        self.assertEqual(self.OFFSET, timedelta(hours=14))

    def test_a_day_shift_has_no_offset(self) -> None:
        self.assertEqual(shift_offset("DAY", time(8, 0), time(17, 0)), timedelta(0))

    def test_check_in_before_midnight_and_check_out_after_share_a_working_date(self) -> None:
        check_in = utc(2026, 9, 1, 15)   # 22:00 local on the 1st
        check_out = utc(2026, 9, 1, 23, 30)  # 06:30 local on the 2nd
        self.assertEqual(work_date(check_in, self.OFFSET).isoformat(), "2026-09-01")
        self.assertEqual(work_date(check_out, self.OFFSET).isoformat(), "2026-09-01")

    def test_a_late_night_arrival_after_midnight_still_belongs_to_the_shift_that_started(self) -> None:
        self.assertEqual(work_date(utc(2026, 9, 1, 17, 30), self.OFFSET).isoformat(), "2026-09-01")  # 00:30 on the 2nd

    def test_the_next_evening_is_a_new_working_date(self) -> None:
        self.assertEqual(work_date(utc(2026, 9, 2, 14, 45), self.OFFSET).isoformat(), "2026-09-02")  # 21:45 on the 2nd

    def test_a_night_session_stays_open_past_midnight_and_closes_at_the_cut(self) -> None:
        opened = utc(2026, 9, 1, 15)  # 22:00 local
        self.assertTrue(session_is_open(opened, utc(2026, 9, 1, 23), self.OFFSET))   # 06:00 next morning
        self.assertTrue(session_is_open(opened, utc(2026, 9, 2, 6, 59), self.OFFSET))  # 13:59
        self.assertFalse(session_is_open(opened, utc(2026, 9, 2, 7, 1), self.OFFSET))  # 14:01


class LocalDateTests(unittest.TestCase):
    def test_evening_utc_is_next_day_locally(self) -> None:
        # 23:00 UTC on the 6th is 06:00 on the 7th in Asia/Ho_Chi_Minh; grouping
        # by UTC would file an early check-in under the previous day.
        self.assertEqual(local_date(utc(2026, 9, 6, 23)).isoformat(), "2026-09-07")

    def test_local_zone_is_ahead_of_utc(self) -> None:
        offset = utc(2026, 9, 1, 0).astimezone(LOCAL_ZONE).utcoffset()
        self.assertEqual(offset, timedelta(hours=7))


if __name__ == "__main__":
    unittest.main()

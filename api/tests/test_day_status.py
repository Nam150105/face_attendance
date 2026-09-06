import unittest
from datetime import datetime, time, timedelta, timezone

from app.services.member_portal import LOCAL_ZONE, _day_status, local_date


def utc(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def shift(start: str, grace: int = 10) -> tuple:
    hour, minute = (int(part) for part in start.split(":"))
    return (time(hour, minute), time(17, 0), grace, None)


class DayStatusTests(unittest.TestCase):
    def test_no_check_in_without_rejection_is_absent(self) -> None:
        self.assertEqual(_day_status(None, None, None, False), "ABSENT")

    def test_no_check_in_after_a_rejected_attempt_is_invalid(self) -> None:
        self.assertEqual(_day_status(None, None, None, True), "INVALID")

    def test_check_in_without_check_out(self) -> None:
        self.assertEqual(_day_status(utc(2026, 9, 1, 1), None, None, False), "MISSING_CHECK_OUT")

    def test_complete_day_without_a_shift_is_valid(self) -> None:
        # No schedule means there is nothing to be late against.
        self.assertEqual(
            _day_status(utc(2026, 9, 1, 6), utc(2026, 9, 1, 10), None, False),
            "VALID",
        )

    def test_on_time_against_a_local_shift(self) -> None:
        # 01:05 UTC is 08:05 in Asia/Ho_Chi_Minh: inside the 08:00 + 10 min grace.
        self.assertEqual(
            _day_status(utc(2026, 9, 1, 1, 5), utc(2026, 9, 1, 10), shift("08:00"), False),
            "VALID",
        )

    def test_late_against_a_local_shift(self) -> None:
        # 02:00 UTC is 09:00 local, well past 08:10.
        self.assertEqual(
            _day_status(utc(2026, 9, 1, 2), utc(2026, 9, 1, 10), shift("08:00"), False),
            "LATE",
        )

    def test_grace_boundary_is_inclusive(self) -> None:
        # Exactly 08:10 local must not count as late.
        self.assertEqual(
            _day_status(utc(2026, 9, 1, 1, 10), utc(2026, 9, 1, 10), shift("08:00"), False),
            "VALID",
        )
        self.assertEqual(
            _day_status(utc(2026, 9, 1, 1, 11), utc(2026, 9, 1, 10), shift("08:00"), False),
            "LATE",
        )

    def test_missing_check_out_wins_over_late(self) -> None:
        # A day can be both; the missing check-out is the one to act on.
        self.assertEqual(
            _day_status(utc(2026, 9, 1, 3), None, shift("08:00"), False),
            "MISSING_CHECK_OUT",
        )


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

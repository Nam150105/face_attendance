import unittest
from datetime import datetime, time, timezone

from app.services.attendance import (
    _minutes_early_leave,
    _minutes_late,
    describe_duration,
)


def utc(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 9, 1, hour, minute, tzinfo=timezone.utc)


# (start, end, grace_minutes, enforce)
RULE = (time(8, 0), time(17, 0), 10, False)


class LatenessTests(unittest.TestCase):
    def test_no_rule_is_never_late(self) -> None:
        self.assertEqual(_minutes_late(None, utc(10)), 0)

    def test_inside_grace_is_not_late(self) -> None:
        # 01:05 UTC = 08:05 local, inside the 10 minute grace.
        self.assertEqual(_minutes_late(RULE, utc(1, 5)), 0)

    def test_exactly_on_the_deadline_is_not_late(self) -> None:
        self.assertEqual(_minutes_late(RULE, utc(1, 10)), 0)

    def test_one_minute_past_the_deadline(self) -> None:
        self.assertEqual(_minutes_late(RULE, utc(1, 11)), 1)

    def test_counts_from_the_deadline_not_the_start(self) -> None:
        # 09:30 local is 90 minutes after 08:00 but 80 after the 08:10 deadline.
        self.assertEqual(_minutes_late(RULE, utc(2, 30)), 80)

    def test_early_arrival_is_not_negative(self) -> None:
        self.assertEqual(_minutes_late(RULE, utc(0, 30)), 0)


class EarlyLeaveTests(unittest.TestCase):
    def test_no_rule_is_never_early(self) -> None:
        self.assertEqual(_minutes_early_leave(None, utc(5)), 0)

    def test_leaving_before_the_end(self) -> None:
        # 08:00 UTC = 15:00 local, two hours before 17:00.
        self.assertEqual(_minutes_early_leave(RULE, utc(8)), 120)

    def test_leaving_on_time_is_zero(self) -> None:
        self.assertEqual(_minutes_early_leave(RULE, utc(10)), 0)

    def test_leaving_late_is_zero_not_negative(self) -> None:
        self.assertEqual(_minutes_early_leave(RULE, utc(12)), 0)

    def test_grace_does_not_apply_to_leaving(self) -> None:
        # 16:55 local is early even though it is within 10 minutes of the end.
        self.assertEqual(_minutes_early_leave(RULE, utc(9, 55)), 5)


class DurationTests(unittest.TestCase):
    def test_reads_as_plain_vietnamese(self) -> None:
        self.assertEqual(describe_duration(5), "5 phút")
        self.assertEqual(describe_duration(60), "1 giờ")
        self.assertEqual(describe_duration(95), "1 giờ 35 phút")
        self.assertEqual(describe_duration(0), "0 phút")


if __name__ == "__main__":
    unittest.main()

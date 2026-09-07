import unittest
from datetime import datetime, time, timezone

from app.services.attendance import (
    _beyond_grace,
    _minutes_early_leave,
    _minutes_late,
    describe_duration,
)


def utc(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 9, 1, hour, minute, tzinfo=timezone.utc)


# (start, end, grace_minutes, enforce)
RULE = (time(8, 0), time(17, 0), 10, False)


class LatenessTests(unittest.TestCase):
    """
    Lateness is counted from the start time, not from the grace deadline: the
    grace window decides how the system reacts, not whether the person was late.
    """

    def test_no_rule_is_never_late(self) -> None:
        self.assertEqual(_minutes_late(None, utc(10)), 0)

    def test_arriving_inside_the_grace_window_still_counts_the_minutes(self) -> None:
        # 01:05 UTC = 08:05 local: 5 minutes after an 08:00 start.
        self.assertEqual(_minutes_late(RULE, utc(1, 5)), 5)

    def test_inside_grace_is_not_refused(self) -> None:
        self.assertFalse(_beyond_grace(RULE, _minutes_late(RULE, utc(1, 5))))

    def test_exactly_on_the_grace_boundary_is_still_allowed(self) -> None:
        late = _minutes_late(RULE, utc(1, 10))
        self.assertEqual(late, 10)
        self.assertFalse(_beyond_grace(RULE, late))

    def test_one_minute_past_the_window_is_beyond_grace(self) -> None:
        late = _minutes_late(RULE, utc(1, 11))
        self.assertEqual(late, 11)
        self.assertTrue(_beyond_grace(RULE, late))

    def test_counts_from_the_start_time(self) -> None:
        # 09:30 local is 90 minutes after an 08:00 start.
        self.assertEqual(_minutes_late(RULE, utc(2, 30)), 90)

    def test_arriving_early_is_not_negative(self) -> None:
        self.assertEqual(_minutes_late(RULE, utc(0, 30)), 0)

    def test_on_time_is_never_beyond_grace(self) -> None:
        self.assertFalse(_beyond_grace(RULE, 0))

    def test_no_rule_is_never_beyond_grace(self) -> None:
        self.assertFalse(_beyond_grace(None, 999))


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

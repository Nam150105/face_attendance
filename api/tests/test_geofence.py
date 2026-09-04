import unittest

from app.domain.geofence import GeofencePolicy, GeofenceStatus, evaluate_geofence, haversine_distance_meters


def point_at_distance_meters(distance_meters: float) -> tuple[float, float]:
    latitude = 10.776889
    target_longitude = 106.700806
    low = target_longitude
    high = target_longitude + 0.01
    for _ in range(50):
        longitude = (low + high) / 2
        if haversine_distance_meters(latitude, longitude, latitude, target_longitude) < distance_meters:
            low = longitude
        else:
            high = longitude
    return latitude, (low + high) / 2


class GeofenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = GeofencePolicy(minimum_accuracy_meters=50)

    def test_boundary_policy(self) -> None:
        cases = (
            (99, GeofenceStatus.ALLOW),
            (100, GeofenceStatus.ALLOW),
            (100.1, GeofenceStatus.WARNING_REASON_REQUIRED),
            (150, GeofenceStatus.WARNING_REASON_REQUIRED),
            (200, GeofenceStatus.WARNING_REASON_REQUIRED),
            (200.1, GeofenceStatus.BLOCK),
        )
        for distance_meters, expected_status in cases:
            latitude, longitude = point_at_distance_meters(distance_meters)
            with self.subTest(distance_meters=distance_meters):
                decision = evaluate_geofence(latitude, longitude, 10, 10.776889, 106.700806, self.policy)
                self.assertEqual(decision.status, expected_status)

    def test_low_accuracy_takes_precedence(self) -> None:
        latitude, longitude = point_at_distance_meters(20)
        decision = evaluate_geofence(latitude, longitude, 50.1, 10.776889, 106.700806, self.policy)
        self.assertEqual(decision.status, GeofenceStatus.GPS_ACCURACY_LOW)


if __name__ == "__main__":
    unittest.main()

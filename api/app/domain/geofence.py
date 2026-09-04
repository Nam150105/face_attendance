from dataclasses import dataclass
from enum import StrEnum
from math import asin, cos, radians, sin, sqrt


class GeofenceStatus(StrEnum):
    ALLOW = "ALLOW"
    WARNING_REASON_REQUIRED = "WARNING_REASON_REQUIRED"
    BLOCK = "BLOCK"
    GPS_ACCURACY_LOW = "GPS_ACCURACY_LOW"


@dataclass(frozen=True)
class GeofencePolicy:
    allow_radius_meters: float = 100
    warning_radius_meters: float = 200
    minimum_accuracy_meters: float = 100


@dataclass(frozen=True)
class GeofenceDecision:
    status: GeofenceStatus
    distance_meters: float
    accuracy_meters: float


def haversine_distance_meters(
    latitude: float,
    longitude: float,
    target_latitude: float,
    target_longitude: float,
) -> float:
    earth_radius_meters = 6_371_000
    latitude_delta = radians(target_latitude - latitude)
    longitude_delta = radians(target_longitude - longitude)
    latitude_a = radians(latitude)
    target_latitude_a = radians(target_latitude)
    a = sin(latitude_delta / 2) ** 2 + cos(latitude_a) * cos(target_latitude_a) * sin(longitude_delta / 2) ** 2
    return 2 * earth_radius_meters * asin(sqrt(a))


def evaluate_geofence(
    latitude: float,
    longitude: float,
    accuracy_meters: float,
    target_latitude: float,
    target_longitude: float,
    policy: GeofencePolicy = GeofencePolicy(),
) -> GeofenceDecision:
    distance_meters = haversine_distance_meters(latitude, longitude, target_latitude, target_longitude)
    boundary_epsilon_meters = 1e-6
    if accuracy_meters > policy.minimum_accuracy_meters:
        status = GeofenceStatus.GPS_ACCURACY_LOW
    elif distance_meters <= policy.allow_radius_meters + boundary_epsilon_meters:
        status = GeofenceStatus.ALLOW
    elif distance_meters <= policy.warning_radius_meters + boundary_epsilon_meters:
        status = GeofenceStatus.WARNING_REASON_REQUIRED
    else:
        status = GeofenceStatus.BLOCK
    return GeofenceDecision(status, distance_meters, accuracy_meters)

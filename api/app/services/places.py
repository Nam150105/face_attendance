from __future__ import annotations

import re

import httpx
from fastapi import HTTPException


# Photon and Nominatim both serve OpenStreetMap data. Photon is tried first because
# nominatim.openstreetmap.org is unreachable from some networks.
PHOTON_SEARCH = "https://photon.komoot.io/api/"
PHOTON_REVERSE = "https://photon.komoot.io/reverse"
NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "face-attendance/1.0 (location picker)"
TIMEOUT = 12

COORDINATE_PATTERN = re.compile(r"^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$")

# Google Maps encodes the pin differently depending on how the link was shared.
URL_PATTERNS = (
    re.compile(r"!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)"),
    re.compile(r"[?&]q=(-?\d{1,3}\.\d+)%2C(-?\d{1,3}\.\d+)"),
    re.compile(r"[?&]q=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)"),
    re.compile(r"[?&](?:ll|center|destination|daddr|sll)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)"),
    re.compile(r"@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)"),
    re.compile(r"/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)"),
)


def _validated(latitude: float, longitude: float) -> tuple[float, float]:
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise HTTPException(status_code=422, detail="PLACE_COORDINATES_INVALID")
    return round(latitude, 7), round(longitude, 7)


def _from_url(url: str) -> tuple[float, float] | None:
    for pattern in URL_PATTERNS:
        match = pattern.search(url)
        if match:
            return _validated(float(match.group(1)), float(match.group(2)))
    return None


def _expand(url: str) -> str:
    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
            return str(client.get(url).url)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="PLACE_LINK_UNREACHABLE") from error


def _photon_label(properties: dict) -> str:
    parts = [
        properties.get("name"),
        properties.get("street"),
        properties.get("district"),
        properties.get("city") or properties.get("county"),
        properties.get("state"),
        properties.get("country"),
    ]
    return ", ".join(part for part in parts if part)


def _photon_search(address: str) -> dict | None:
    try:
        with httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
            response = client.get(PHOTON_SEARCH, params={"q": address, "limit": 1})
            response.raise_for_status()
            features = response.json().get("features", [])
    except (httpx.HTTPError, ValueError):
        return None
    if not features:
        return None
    longitude, latitude = features[0]["geometry"]["coordinates"]
    latitude, longitude = _validated(float(latitude), float(longitude))
    return {
        "latitude": latitude,
        "longitude": longitude,
        "label": _photon_label(features[0].get("properties", {})) or None,
        "source": "geocoder",
    }


def _nominatim_search(address: str) -> dict | None:
    try:
        with httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
            response = client.get(NOMINATIM_SEARCH, params={"q": address, "format": "jsonv2", "limit": 1})
            response.raise_for_status()
            results = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    if not results:
        return None
    latitude, longitude = _validated(float(results[0]["lat"]), float(results[0]["lon"]))
    return {
        "latitude": latitude,
        "longitude": longitude,
        "label": results[0].get("display_name"),
        "source": "geocoder",
    }


def resolve_place(query: str) -> dict:
    """Turn a pasted coordinate pair, map link, or address into coordinates."""
    query = query.strip()
    if not query:
        raise HTTPException(status_code=422, detail="PLACE_QUERY_REQUIRED")

    coordinates = COORDINATE_PATTERN.match(query)
    if coordinates:
        latitude, longitude = _validated(float(coordinates.group(1)), float(coordinates.group(2)))
        return {"latitude": latitude, "longitude": longitude, "label": None, "source": "coordinates"}

    if query.startswith("http://") or query.startswith("https://"):
        found = _from_url(query) or _from_url(_expand(query))
        if found is None:
            raise HTTPException(status_code=422, detail="PLACE_LINK_HAS_NO_COORDINATES")
        return {"latitude": found[0], "longitude": found[1], "label": None, "source": "map_link"}

    result = _photon_search(query) or _nominatim_search(query)
    if result is None:
        raise HTTPException(status_code=404, detail="PLACE_NOT_FOUND")
    return result


def reverse_geocode(latitude: float, longitude: float) -> dict:
    try:
        with httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
            response = client.get(PHOTON_REVERSE, params={"lat": latitude, "lon": longitude})
            response.raise_for_status()
            features = response.json().get("features", [])
        if features:
            return {"label": _photon_label(features[0].get("properties", {})) or None}
    except (httpx.HTTPError, ValueError):
        pass
    try:
        with httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}) as client:
            response = client.get(NOMINATIM_REVERSE, params={"lat": latitude, "lon": longitude, "format": "jsonv2"})
            response.raise_for_status()
            return {"label": response.json().get("display_name")}
    except (httpx.HTTPError, ValueError):
        return {"label": None}

from datetime import time
from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from app.auth import CurrentUser, get_current_user, require_role
from app.services.places import resolve_place, reverse_geocode
from app.services.locations import (
    assign_location,
    create_location,
    evaluate_member_location,
    get_location,
    list_assigned_locations,
    list_locations,
    delete_location,
    remove_location,
    unassign_location,
    update_location,
)


class LocationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    allow_radius_meters: int = Field(default=100, gt=0)
    warning_radius_meters: int = Field(default=200, gt=0)
    is_active: bool = True
    # The only source of working hours; there is no per-member override.
    expected_check_in: time | None = None
    expected_check_out: time | None = None
    grace_minutes: int = Field(default=10, ge=0, le=240)
    # Off: late arrivals are recorded and reported. On: they are refused.
    enforce_hours: bool = False


class AssignmentRequest(BaseModel):
    location_id: UUID
    is_default: bool = False


class PlaceLookupRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)


class ReverseLookupRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class GeofenceRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    gps_accuracy_meters: float = Field(ge=0)
    minimum_accuracy_meters: float = Field(default=100, gt=0)


router = APIRouter(prefix="/manager/locations", tags=["locations"])


@router.get("")
def locations(user: CurrentUser = Depends(require_role("MANAGER"))) -> list[dict]:
    return list_locations(user.id)


@router.post("", status_code=status.HTTP_201_CREATED)
def create(request: LocationRequest, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return create_location(user.id, request.model_dump())


@router.get("/{location_id}")
def detail(location_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return get_location(user.id, location_id)


@router.put("/{location_id}")
def update(location_id: UUID, request: LocationRequest, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return update_location(user.id, location_id, request.model_dump())


@router.delete("/{location_id}")
def remove(location_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return remove_location(user.id, location_id)


assignment_router = APIRouter(prefix="/manager/members", tags=["locations"])


@assignment_router.post("/{member_id}/locations")
def assign(member_id: UUID, request: AssignmentRequest, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return assign_location(user.id, member_id, request.location_id, request.is_default)


member_router = APIRouter(prefix="/locations", tags=["locations"])


@member_router.post("/{location_id}/evaluate")
def evaluate(location_id: UUID, request: GeofenceRequest, user: CurrentUser = Depends(get_current_user)) -> dict:
    return evaluate_member_location(user.id, location_id, request.model_dump())


@assignment_router.get("/{member_id}/locations")
def assigned(member_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> list[dict]:
    return list_assigned_locations(user.id, member_id)


@assignment_router.delete("/{member_id}/locations/{location_id}")
def unassign(member_id: UUID, location_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return unassign_location(user.id, member_id, location_id)


@router.delete("/{location_id}/permanent")
def destroy(location_id: UUID, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return delete_location(user.id, location_id)


@router.post("/resolve-place")
def resolve(request: PlaceLookupRequest, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return resolve_place(request.query)


@router.post("/reverse-place")
def reverse(request: ReverseLookupRequest, user: CurrentUser = Depends(require_role("MANAGER"))) -> dict:
    return reverse_geocode(request.latitude, request.longitude)

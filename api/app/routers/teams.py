from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from app.auth import CurrentUser, get_current_user
from app.security import client_ip, enforce_rate_limit, safe_image_content_type
from app.services.face_requests import (
    decide as decide_face_change,
    list_requests as list_face_requests,
    request_photo as face_request_photo_bytes,
)
from app.services.permissions import require_action, require_screen
from app.services.teams import (
    attach_location,
    create_team,
    detach_location,
    decide_join_request,
    delete_team,
    list_join_requests,
    list_team_locations,
    list_teams,
    my_join_requests,
    preview_team,
    request_join,
    team_members,
    update_team,
)


class TeamRequest(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=24)


class TeamUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    is_open: bool | None = None


class JoinRequest(BaseModel):
    code: str = Field(min_length=3, max_length=24)


class DecisionRequest(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=500)


router = APIRouter(prefix="/manager/teams", tags=["teams"])


@router.get("")
def teams(user: CurrentUser = Depends(require_screen("members"))) -> list[dict]:
    return list_teams(user)


@router.post("", status_code=201)
def create(request: TeamRequest, user: CurrentUser = Depends(require_action("members", "create"))) -> dict:
    return create_team(user, request.name, request.code)


@router.put("/{team_id}")
def update(
    team_id: UUID, request: TeamUpdateRequest,
    user: CurrentUser = Depends(require_action("members", "edit")),
) -> dict:
    return update_team(user, team_id, request.name, request.is_open)


@router.delete("/{team_id}")
def remove(team_id: UUID, user: CurrentUser = Depends(require_action("members", "delete"))) -> dict:
    return delete_team(user, team_id)


requests_router = APIRouter(prefix="/manager/join-requests", tags=["teams"])


@requests_router.get("")
def pending(user: CurrentUser = Depends(require_screen("join-requests"))) -> list[dict]:
    return list_join_requests(user)


@requests_router.post("/{member_id}")
def decide(
    member_id: UUID, request: DecisionRequest,
    user: CurrentUser = Depends(require_action("join-requests", "edit")),
) -> dict:
    return decide_join_request(user, member_id, request.approve, request.note)


member_router = APIRouter(prefix="/teams", tags=["teams"])


@member_router.get("/lookup/{code}")
def lookup(code: str, http_request: Request) -> dict:
    """
    Confirm a code before committing to it.

    Open to people who are not signed in, because the moment this matters most
    is halfway through the sign-up form. It gives back only the unit's name and
    its manager's, and it is limited per address — guessing codes one at a time
    is how somebody maps an organisation they were never part of.
    """
    enforce_rate_limit("team-lookup", client_ip(http_request), limit=20, window_seconds=300)
    return preview_team(code)


@member_router.post("/join")
def join(request: JoinRequest, user: CurrentUser = Depends(get_current_user)) -> dict:
    enforce_rate_limit("team-join", str(user.id), limit=10, window_seconds=3600)
    return request_join(user.id, request.code)


@member_router.get("/my-requests")
def mine(user: CurrentUser = Depends(get_current_user)) -> list[dict]:
    return my_join_requests(user.id)


face_router = APIRouter(prefix="/manager/face-requests", tags=["faces"])


class FaceDecisionRequest(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=500)


@face_router.get("")
def face_requests(user: CurrentUser = Depends(require_screen("face-requests"))) -> list[dict]:
    return list_face_requests(user)


@face_router.get("/{request_id}/photo")
def face_request_photo(
    request_id: UUID, user: CurrentUser = Depends(require_screen("face-requests"))
) -> Response:
    content, content_type = face_request_photo_bytes(user, request_id)
    return Response(
        content=content,
        media_type=safe_image_content_type(content_type),
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    )


@face_router.post("/{request_id}")
def decide_face_request(
    request_id: UUID, request: FaceDecisionRequest,
    user: CurrentUser = Depends(require_action("face-requests", "edit")),
) -> dict:
    return decide_face_change(user, request_id, request.approve, request.note)


class TeamLocationRequest(BaseModel):
    location_id: UUID
    is_default: bool = False


@router.get("/{team_id}/locations")
def team_places(team_id: UUID, user: CurrentUser = Depends(require_screen("members"))) -> list[dict]:
    return list_team_locations(user, team_id)


@router.post("/{team_id}/locations")
def add_team_place(
    team_id: UUID, request: TeamLocationRequest,
    user: CurrentUser = Depends(require_action("members", "edit")),
) -> dict:
    return attach_location(user, team_id, request.location_id, request.is_default)


@router.delete("/{team_id}/locations/{location_id}")
def remove_team_place(
    team_id: UUID, location_id: UUID,
    user: CurrentUser = Depends(require_action("members", "edit")),
) -> dict:
    return detach_location(user, team_id, location_id)


@router.get("/{team_id}/members")
def team_roster(team_id: UUID, user: CurrentUser = Depends(require_screen("members"))) -> list[dict]:
    return team_members(user, team_id)

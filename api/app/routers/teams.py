from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.auth import CurrentUser, get_current_user
from app.security import client_ip, enforce_rate_limit
from app.services.permissions import require_action, require_screen
from app.services.teams import (
    create_team,
    decide_join_request,
    delete_team,
    list_join_requests,
    list_teams,
    my_join_requests,
    preview_team,
    request_join,
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

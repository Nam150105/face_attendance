from fastapi import APIRouter, Depends

from app.auth import CurrentUser, require_role


router = APIRouter(prefix="/manager", tags=["manager"])


@router.get("/dashboard")
def dashboard(user: CurrentUser = Depends(require_role("MANAGER"))) -> dict[str, str]:
    return {"status": "ok", "manager_id": str(user.id)}

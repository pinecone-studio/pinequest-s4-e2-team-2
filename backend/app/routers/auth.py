from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.models.entities import UserProfile
from app.services.auth_service import get_current_user


router = APIRouter(prefix="/auth", tags=["auth"])


# --- Firebase / Google login (schema branch) ---

@router.get("/me", response_model=UserProfile)
def read_current_user(current_user: UserProfile = Depends(get_current_user)) -> UserProfile:
    return current_user


@router.post("/sync", response_model=UserProfile)
def sync_current_user(current_user: UserProfile = Depends(get_current_user)) -> UserProfile:
    return current_user


# --- Email/password auth (EXTENSION POINT, not yet implemented) ---

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/register")
async def register(request: RegisterRequest):
    return {"message": "Auth not yet implemented"}


@router.post("/login")
async def login(request: LoginRequest):
    return {"message": "Auth not yet implemented"}


@router.post("/logout")
async def logout():
    return {"message": "Auth not yet implemented"}

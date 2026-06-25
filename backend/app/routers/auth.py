from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/auth")

# EXTENSION POINT: full auth with PostgreSQL users table


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

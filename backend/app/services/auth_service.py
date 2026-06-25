from typing import Annotated

from fastapi import Header, HTTPException, status

from app.config import get_settings
from app.models.entities import UserProfile
from app.services import cache_service
from app.services.firebase_service import verify_id_token


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header.",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be `Bearer <firebase_id_token>`.",
        )

    return token


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> UserProfile:
    token = _bearer_token(authorization)

    try:
        decoded = verify_id_token(token)
    except Exception as exc:
        settings = get_settings()
        detail = "Invalid Firebase token."
        if settings.environment == "local":
            detail = f"Invalid Firebase token: {type(exc).__name__}: {exc}"
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
        ) from exc

    return cache_service.upsert_user_from_token(decoded)

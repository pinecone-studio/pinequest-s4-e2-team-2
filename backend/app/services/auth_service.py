import os
from typing import Annotated

from fastapi import Cookie, Header, HTTPException, status

from app.config import get_settings
from app.models.entities import UserProfile
from app.services import cache_service, session_service
from app.services.firebase_service import verify_id_token


def _firebase_credentials_configured() -> bool:
    settings = get_settings()
    if settings.firebase_credentials_json:
        return True
    if settings.firebase_credentials_json_base64:
        return True
    # A configured path still counts as "missing" if the file isn't actually
    # there (e.g. a teammate's local path left over in a shared .env).
    return bool(
        settings.firebase_credentials_path
        and os.path.isfile(settings.firebase_credentials_path)
    )


def _bearer_token(authorization: str) -> str:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be `Bearer <firebase_id_token>`.",
        )

    return token


def _guest_user(session_id: str) -> UserProfile:
    return UserProfile(id=session_id, display_name="Guest", is_guest=True)


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    # Python name deliberately differs from the `session_id` path parameter
    # used elsewhere (e.g. /summaries/chat/sessions/{session_id}/messages) —
    # FastAPI's dependant resolver matches sub-dependency parameter names
    # against path param names for whichever route pulls this dependency in,
    # and a same-named param with a default collides with the path one.
    # The cookie on the wire is still literally named "session_id".
    guest_session_id: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> UserProfile:
    # 1. Firebase ID token, when one is presented and admin credentials are
    #    actually configured (otherwise verify_id_token can't succeed anyway).
    if authorization and _firebase_credentials_configured():
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

        try:
            return cache_service.upsert_user_from_token(decoded)
        except Exception as exc:
            settings = get_settings()
            detail = "User data service is temporarily unavailable."
            if settings.environment == "local":
                detail = f"{detail} {type(exc).__name__}: {exc}"
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=detail,
            ) from exc

    # 2. Guest session cookie, issued by POST /auth/guest.
    if guest_session_id and session_service.get_guest_session(guest_session_id):
        return _guest_user(guest_session_id)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required: provide a Firebase token or call POST /auth/guest first.",
    )

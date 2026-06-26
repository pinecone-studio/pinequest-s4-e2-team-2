from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.models.entities import UserProfile
from app.services import cache_service, session_service
from app.services.auth_service import get_current_user
from app.services.firebase_service import get_firebase_app


router = APIRouter(prefix="/auth", tags=["auth"])


# --- Firebase / Google login (schema branch) ---

@router.get("/me", response_model=UserProfile)
def read_current_user(current_user: UserProfile = Depends(get_current_user)) -> UserProfile:
    return current_user


@router.post("/sync", response_model=UserProfile)
def sync_current_user(current_user: UserProfile = Depends(get_current_user)) -> UserProfile:
    return current_user


# --- Guest / tester sessions (no Firebase required) ---

@router.post("/guest", response_model=UserProfile)
def create_guest_session(response: Response) -> UserProfile:
    session = session_service.create_guest_session()
    # SameSite=None is required because frontend and backend are always
    # different origins here (Vercel <-> Render, or localhost:3000 <->
    # 127.0.0.1:8000 in dev), and SameSite=None requires Secure. That means
    # this cookie only round-trips over real HTTPS â€” it works against the
    # deployed Render backend, but NOT against a local backend served over
    # plain http://127.0.0.1:8000 (browsers withhold Secure cookies on any
    # non-HTTPS connection; there is no localhost exception for this, unlike
    # for "powerful feature" APIs). Test guest sessions against the deployed
    # backend, or run local dev over HTTPS, to exercise this flow.
    response.set_cookie(
        key="session_id",
        value=session.session_id,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=60 * 60 * 24 * 30,
    )
    return UserProfile(id=session.session_id, display_name="Guest", is_guest=True)


# --- Email/password auth ---

class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=6, max_length=128)
    name: str | None = Field(default=None, max_length=120)


class RegisterResponse(BaseModel):
    user: UserProfile
    custom_token: str


class LoginRequest(BaseModel):
    email: str
    password: str


def _demo_identity() -> dict[str, str]:
    identity = {
        "uid": "sightahead-demo-user",
        "email": "demo@sightahead.local",
    }
    identity["name"] = "Demo user"
    return identity


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(request: RegisterRequest) -> RegisterResponse:
    from firebase_admin import auth as firebase_auth

    email = request.email.strip().lower()
    display_name = (request.name or "").strip() or None
    created_uid: str | None = None

    try:
        get_firebase_app()
        created_user = firebase_auth.create_user(
            email=email,
            password=request.password,
            display_name=display_name,
        )
        created_uid = created_user.uid
        user = cache_service.upsert_user_from_token(
            {
                "uid": created_user.uid,
                "email": created_user.email,
                "name": created_user.display_name,
                "picture": created_user.photo_url,
            }
        )
        custom_token = firebase_auth.create_custom_token(created_user.uid).decode("utf-8")
        return RegisterResponse(user=user, custom_token=custom_token)
    except firebase_auth.EmailAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered.",
        ) from exc
    except ValueError as exc:
        if created_uid:
            try:
                firebase_auth.delete_user(created_uid)
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Registration failed.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        if created_uid:
            try:
                firebase_auth.delete_user(created_uid)
            except Exception:
                pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed.",
        ) from exc


@router.post("/demo", response_model=RegisterResponse)
def demo_login() -> RegisterResponse:
    from firebase_admin import auth as firebase_auth

    demo = _demo_identity()

    try:
        get_firebase_app()
        try:
            firebase_user = firebase_auth.get_user(demo["uid"])
        except firebase_auth.UserNotFoundError:
            try:
                firebase_user = firebase_auth.get_user_by_email(demo["email"])
            except firebase_auth.UserNotFoundError:
                firebase_user = firebase_auth.create_user(
                    uid=demo["uid"],
                    email=demo["email"],
                    display_name=demo["name"],
                )

        user = cache_service.upsert_user_from_token(
            {
                "uid": firebase_user.uid,
                "email": firebase_user.email or demo["email"],
                "name": firebase_user.display_name or demo["name"],
                "picture": firebase_user.photo_url,
            }
        )
        custom_token = firebase_auth.create_custom_token(firebase_user.uid).decode("utf-8")
        return RegisterResponse(user=user, custom_token=custom_token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Demo login failed.",
        ) from exc


@router.post("/login")
async def login(request: LoginRequest):
    return {"message": "Auth not yet implemented"}


@router.post("/logout")
async def logout():
    return {"message": "Auth not yet implemented"}

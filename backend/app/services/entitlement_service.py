from fastapi import HTTPException, status

from app.models.entities import UserEntitlements, UserProfile
from app.services import cache_service


def get_entitlements(current_user: UserProfile) -> UserEntitlements:
    return cache_service.get_user_entitlements(current_user.id)


def require_pro(current_user: UserProfile) -> UserEntitlements:
    entitlements = get_entitlements(current_user)
    if entitlements.is_pro:
        return entitlements
    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail="Pro subscription required.",
    )


def require_video_access(
    current_user: UserProfile,
    video_id: str,
    language_code: str = "mn",
) -> UserEntitlements:
    try:
        return cache_service.record_video_access(
            current_user.id,
            video_id,
            language_code=language_code,
        )
    except cache_service.FreeVideoLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Free video limit reached. Upgrade to Pro to continue.",
        ) from exc

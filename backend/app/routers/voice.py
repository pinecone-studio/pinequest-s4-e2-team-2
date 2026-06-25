from fastapi import APIRouter, Depends, Query, status

from app.models.entities import UserProfile, VoiceProfileCreate, VoiceProfileRecord
from app.services import cache_service
from app.services.auth_service import get_current_user


router = APIRouter(prefix="/voices", tags=["voices"])


@router.post("", response_model=VoiceProfileRecord, status_code=status.HTTP_201_CREATED)
def create_voice_profile(
    payload: VoiceProfileCreate,
    current_user: UserProfile = Depends(get_current_user),
) -> VoiceProfileRecord:
    return cache_service.create_voice_profile(payload)


@router.get("", response_model=list[VoiceProfileRecord])
def list_voice_profiles(
    active_only: bool = Query(default=True),
    current_user: UserProfile = Depends(get_current_user),
) -> list[VoiceProfileRecord]:
    return cache_service.list_voice_profiles(active_only=active_only)

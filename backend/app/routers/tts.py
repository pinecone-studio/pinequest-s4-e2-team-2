import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.models.entities import UserProfile
from app.services.auth_service import get_current_user
from app.services.entitlement_service import require_video_access
from app.services.tts_service import synthesize
from app.utils.audio import save_audio, audio_url_path, audio_duration_ms

logger = logging.getLogger(__name__)  # CHANGED: log TTS events

router = APIRouter(prefix="/tts")


class TTSRequest(BaseModel):
    text: str
    video_id: str
    index: int
    gender: str = "female"


class TTSResponse(BaseModel):
    audio_url: str
    audio_ms: int


@router.post("", response_model=TTSResponse)
def synthesize_segment(
    request: TTSRequest,
    current_user: UserProfile = Depends(get_current_user),
):
    require_video_access(current_user, request.video_id)
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    # CHANGED: log the vocalizing (dub) event so progress is traceable.
    logger.info("/tts ← synthesizing segment %d (video_id=%s, gender=%s)",
                request.index, request.video_id, request.gender)
    audio_bytes = synthesize(request.text, {"gender": request.gender})
    path = save_audio(audio_bytes, request.video_id, request.index)
    audio_ms = audio_duration_ms(path)
    logger.info("/tts → segment %d done (audio_ms=%d)", request.index, audio_ms)

    return TTSResponse(
        audio_url=audio_url_path(request.video_id, request.index),
        audio_ms=audio_ms,
    )

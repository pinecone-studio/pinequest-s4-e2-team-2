from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.tts_service import synthesize
from app.utils.audio import save_audio, audio_url_path, audio_duration_ms

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
def synthesize_segment(request: TTSRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    audio_bytes = synthesize(request.text, {"gender": request.gender})
    path = save_audio(audio_bytes, request.video_id, request.index)
    audio_ms = audio_duration_ms(path)

    return TTSResponse(
        audio_url=audio_url_path(request.video_id, request.index),
        audio_ms=audio_ms,
    )

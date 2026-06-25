from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.caption_fetcher import fetch_captions
from app.services.whisper_service import transcribe
from app.services.translator import to_mongolian
from app.services.tts_service import synthesize
from app.services.cache_service import get_cached_video, cache_video
from app.utils.audio import save_audio, audio_url_path, audio_duration_ms
from app.utils.video import extract_video_id

router = APIRouter()


class ProcessRequest(BaseModel):
    video_id: str


@router.post("/process")
async def process_video(request: ProcessRequest):
    video_id = extract_video_id(request.video_id)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or video ID")

    cached = get_cached_video(video_id)
    if cached:
        return cached

    # PATH A: YouTube captions
    caption_result = fetch_captions(video_id)

    if caption_result:
        source_lang, segments = caption_result
    else:
        # PATH B: yt-dlp + Whisper fallback
        # EXTENSION POINT: Whisper transcription for videos without captions
        raise HTTPException(status_code=422, detail={
            "code": "NO_CAPTIONS",
            "message": "This video has no captions. Whisper fallback is not yet implemented.",
        })

    # Translate to Mongolian
    segments = to_mongolian(segments, source_lang)

    # TTS for each segment
    result_segments = []
    for i, seg in enumerate(segments):
        audio_bytes = synthesize(seg.translated_text or seg.text)
        path = save_audio(audio_bytes, video_id, i)
        audio_ms = audio_duration_ms(path)
        seg = seg.model_copy(update={"audio_path": audio_url_path(video_id, i), "audio_ms": audio_ms})
        result_segments.append(seg.model_dump())

    result = {"video_id": video_id, "segments": result_segments}
    cache_video(video_id, result)
    return result

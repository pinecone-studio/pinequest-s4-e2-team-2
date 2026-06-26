"""Synchronous dub pipeline: YouTube captions -> Mongolian translation -> TTS dub.

PATH A only (youtube_transcript_api captions). The yt-dlp + Whisper audio
fallback (Path B) was removed for the free-tier deploy — it needs heavy ML
deps and gets IP-blocked by YouTube on datacenter hosts anyway. If a video has
no captions, the frontend's own transcript route is the showcase fallback.
"""

import os

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.config import get_settings
from app.utils.audio import save_audio, audio_url_path, audio_duration_ms_from_bytes
from app.services.caption_fetcher import fetch_captions
from app.services.translator import to_mongolian
from app.services.tts_service import synthesize
from app.services.summary_service import summarize
from app.services.cache_service import get_cached_video, cache_video
from app.utils.video import extract_video_id
from app.models.segment import Segment

router = APIRouter(tags=["pipeline"])


class ProcessRequest(BaseModel):
    video_id: str


class SummaryRequest(BaseModel):
    video_id: str


def _empty_process_result(video_id: str) -> dict:
    return {"video_id": video_id, "segments": []}


def _local_processing_enabled() -> bool:
    return os.getenv("ENABLE_LOCAL_PROCESSING", "").strip().lower() in {"1", "true", "yes"}


@router.post("/captions")
async def get_captions(request: ProcessRequest):
    """Lightweight captions-only path: youtube_transcript_api segments, no
    translation/TTS/upload. Fast enough for the free tier, and independent of
    the ENVIRONMENT processing guard that /process uses."""
    video_id = extract_video_id(request.video_id)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or video ID")

    try:
        caption_result = fetch_captions(video_id)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Caption service is temporarily unavailable.",
        ) from exc

    if not caption_result:
        raise HTTPException(status_code=422, detail="No captions available for this video.")

    source_lang, segments = caption_result
    return {
        "video_id": video_id,
        "source_lang": source_lang,
        "segments": [seg.model_dump() for seg in segments],
    }


@router.post("/process")
async def process_video(request: ProcessRequest):
    video_id = extract_video_id(request.video_id)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or video ID")

    cached = get_cached_video(video_id)
    if cached:
        return cached

    if get_settings().environment == "local" and not _local_processing_enabled():
        result = _empty_process_result(video_id)
        cache_video(video_id, result)
        return result

    try:
        # PATH A: YouTube captions (youtube_transcript_api). No Path B fallback.
        caption_result = fetch_captions(video_id)
        if not caption_result:
            raise HTTPException(
                status_code=422,
                detail="No captions available for this video.",
            )
        source_lang, segments = caption_result

        # Translate to Mongolian (OpenAI)
        segments = to_mongolian(segments, source_lang)

        # TTS for each segment (Azure)
        result_segments = []
        for i, seg in enumerate(segments):
            audio_bytes = synthesize(seg.translated_text or seg.text)
            audio_ms = audio_duration_ms_from_bytes(audio_bytes)  # before upload
            save_audio(audio_bytes, video_id, i)                 # uploads, returns public URL
            seg = seg.model_copy(update={"audio_path": audio_url_path(video_id, i), "audio_ms": audio_ms})
            result_segments.append(seg.model_dump())
    except HTTPException:
        raise
    except Exception as exc:
        if get_settings().environment == "local":
            result = _empty_process_result(video_id)
            cache_video(video_id, result)
            return result
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Video processing is temporarily unavailable.",
        ) from exc

    result = {"video_id": video_id, "segments": result_segments}
    cache_video(video_id, result)
    return result


@router.post("/summary")
async def get_summary(request: SummaryRequest):
    cached = get_cached_video(request.video_id)
    if not cached:
        raise HTTPException(
            status_code=404,
            detail="Video not processed yet. Call POST /process first.",
        )

    segments = [Segment(**s) for s in cached.get("segments", [])]
    summary = summarize(segments)
    return {"video_id": request.video_id, "summary": summary}

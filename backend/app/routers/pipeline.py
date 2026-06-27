"""Synchronous dub pipeline: YouTube captions -> Mongolian translation -> TTS dub.

PATH A only (youtube_transcript_api captions). The yt-dlp + Whisper audio
fallback (Path B) has been removed: it needs heavy ML deps and gets IP-blocked
by YouTube on datacenter hosts anyway. If a video has no captions, /process
returns 422.
"""

import logging
import os

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.config import get_settings
from app.utils.audio import save_audio, audio_duration_ms_from_bytes
from app.services.caption_fetcher import fetch_captions
from app.services.translator import to_mongolian
from app.services.tts_service import synthesize
from app.services.summary_service import summarize
from app.services.cache_service import get_cached_video, cache_video
from app.utils.video import extract_video_id
from app.models.segment import Segment

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pipeline"])


class CaptionSegment(BaseModel):
    start: float
    duration: float
    text: str


class ProcessRequest(BaseModel):
    video_id: str
    segments: list[CaptionSegment] | None = None  # pre-fetched from browser (avoids IP block)
    source_lang: str = "en"


class SummaryRequest(BaseModel):
    video_id: str


def _empty_process_result(video_id: str) -> dict:
    return {"video_id": video_id, "segments": []}


def _local_processing_enabled() -> bool:
    return os.getenv("ENABLE_LOCAL_PROCESSING", "").strip().lower() in {"1", "true", "yes"}


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
        # Use client-supplied captions if provided (browser-side fetch avoids Railway IP block).
        if request.segments:
            source_lang = request.source_lang
            segments = [
                Segment(start=s.start, duration=s.duration, text=s.text, source="youtube_captions")
                for s in request.segments
            ]
            logger.info("using client captions: %s (%d segments, lang=%s)", video_id, len(segments), source_lang)
        else:
            # PATH A: server-side caption fetch (may be IP-blocked on Railway).
            caption_result = fetch_captions(video_id)
            if not caption_result:
                raise HTTPException(
                    status_code=422,
                    detail="No captions available for this video.",
                )
            source_lang, segments = caption_result
            logger.info("caption found: %s (%d segments, lang=%s)", video_id, len(segments), source_lang)

        # Translate to Mongolian (batched — few API calls, not one per segment).
        logger.info("translating: %s", video_id)
        segments = to_mongolian(segments, source_lang)

        # TTS (dub) for each segment -> upload to Firebase Storage.
        result_segments = []
        for i, seg in enumerate(segments):
            audio_bytes = synthesize(seg.translated_text or seg.text)
            audio_ms = audio_duration_ms_from_bytes(audio_bytes)  # before upload
            audio_url = save_audio(audio_bytes, video_id, i)      # public Storage URL
            seg = seg.model_copy(update={"audio_path": audio_url, "audio_ms": audio_ms})
            result_segments.append(seg.model_dump())
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("processing failed for %s", video_id)
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

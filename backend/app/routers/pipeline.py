"""Streaming dub pipeline.

The YouTube transcript is fetched CLIENT-SIDE (Vercel /api/youtube/transcript)
because datacenter IPs get blocked by YouTube. The client POSTs the raw segments
here; we batch-translate them to Mongolian (duration-aware) and run TTS per
segment, streaming each finished segment back over SSE with inline base64 audio
so the UI can play it like a live dub.
"""

import base64
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.utils.audio import audio_duration_ms_from_bytes
from app.services.translator import translate_timed
from app.services.tts_service import synthesize
from app.services.summary_service import summarize
from app.services.cache_service import get_cached_video
from app.models.segment import Segment

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pipeline"])


class SegmentInput(BaseModel):
    start: float = 0.0
    duration: float = 0.0
    text: str


class ProcessRequest(BaseModel):
    video_id: str | None = None
    source_lang: str = "en"
    segments: list[SegmentInput] = []


class SummaryRequest(BaseModel):
    video_id: str


def _sse(obj: dict) -> str:
    """Format one Server-Sent Events message."""
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.post("/process")
async def process_video(request: ProcessRequest):
    segments_in = request.segments
    if not segments_in:
        raise HTTPException(
            status_code=400,
            detail="No segments provided. Send the client-fetched transcript in `segments`.",
        )

    def event_stream():
        total = len(segments_in)

        # 1. Batch-translate everything up front (few API calls), duration-aware.
        logger.info("translating %d segments (lang=%s)", total, request.source_lang)
        try:
            translations = translate_timed(
                [(seg.text, seg.duration) for seg in segments_in], request.source_lang
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("translation failed")
            yield _sse({"error": f"translation failed: {exc}"})
            return

        # 2. TTS per segment, streaming each one back as soon as it's ready.
        for i, seg in enumerate(segments_in):
            mn_text = translations[i] if i < len(translations) else seg.text
            try:
                audio_bytes = synthesize(mn_text)
                audio_ms = audio_duration_ms_from_bytes(audio_bytes)
                audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
            except Exception:  # noqa: BLE001
                logger.exception("TTS failed for segment %d", i)
                audio_b64, audio_ms = "", 0

            yield _sse(
                {
                    "index": i,
                    "total": total,
                    "segment": {
                        "offset": seg.start,
                        "duration": seg.duration,
                        "text": seg.text,
                        "translated_text": mn_text,
                        "audio_b64": audio_b64,
                        "audio_ms": audio_ms,
                    },
                }
            )

        yield _sse({"done": True, "total": total})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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

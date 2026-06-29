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
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.utils.audio import audio_duration_ms_from_bytes
from app.services.translator import translate_timed
from app.services.tts_service import synthesize
from app.services.summary_service import summarize
from app.services.cache_service import get_cached_video, cache_video, save_summary, get_latest_summary
from app.models.entities import SummaryCreate
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
    gender: str = "female"
    # When False, translate only (no TTS) — used to populate translated subtitles
    # without paying for audio synthesis. Dub mode sends tts=True.
    tts: bool = True


class SummaryRequest(BaseModel):
    video_id: str


def _sse(obj: dict) -> str:
    """Format one Server-Sent Events message."""
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@router.post("/process")
async def process_video(request: ProcessRequest):
    segments_in = request.segments

    # ── Log what the transcript route RECEIVED from the client ──────────
    total_chars = sum(len(seg.text) for seg in segments_in)
    logger.info(
        "/process ← received transcript: video_id=%s source_lang=%s segments=%d chars=%d",
        request.video_id,
        request.source_lang,
        len(segments_in),
        total_chars,
    )
    if segments_in:
        first = segments_in[0]
        logger.debug(
            "/process first segment: start=%.2f dur=%.2f text=%r",
            first.start,
            first.duration,
            first.text[:120],
        )

    if not segments_in:
        logger.warning("/process ✗ rejected: no segments provided (video_id=%s)", request.video_id)
        raise HTTPException(
            status_code=400,
            detail="No segments provided. Send the client-fetched transcript in `segments`.",
        )

    def event_stream():
        total = len(segments_in)

        # 1. Batch-translate everything up front (few API calls), duration-aware.
        logger.info("/process translating %d segments (lang=%s)", total, request.source_lang)
        try:
            translations = translate_timed(
                [(seg.text, seg.duration) for seg in segments_in], request.source_lang
            )
            logger.info("/process translation ok: %d translations returned", len(translations))
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "/process ✗ translation failed (video_id=%s, segments=%d)",
                request.video_id,
                total,
            )
            yield _sse({"error": f"translation failed: {type(exc).__name__}: {exc}"})
            return

        # Translate-only fast path (subtitles): stream the translated text with no
        # audio, then finish. Avoids the cost/latency of TTS when no dub is needed.
        if not request.tts:
            for i, seg in enumerate(segments_in):
                mn_text = translations[i] if i < len(translations) else seg.text
                yield _sse(
                    {
                        "index": i,
                        "total": total,
                        "segment": {
                            "offset": seg.start,
                            "duration": seg.duration,
                            "text": seg.text,
                            "translated_text": mn_text,
                            "audio_b64": "",
                            "audio_ms": 0,
                        },
                    }
                )
            if request.video_id:
                try:
                    cache_video(request.video_id, {"source_lang": request.source_lang, "segments": [
                        {"start": s.start, "duration": s.duration, "text": s.text,
                         "source": "youtube_captions",
                         "translated_text": translations[i] if i < len(translations) else s.text}
                        for i, s in enumerate(segments_in)
                    ]})
                except Exception:
                    logger.warning("/process cache_video failed (non-fatal)", exc_info=True)
            logger.info("/process → done (translate-only): %d segments (video_id=%s)", total, request.video_id)
            yield _sse({"done": True, "total": total})
            return

        # 2. TTS in parallel — all segments at once, stream each as it finishes.
        # Frontend places segments by index so out-of-order delivery is fine.
        tts_failures = 0

        _bracket_only = re.compile(r"^\s*(\[.*?\]\s*)+$")

        def _tts_one(i: int) -> tuple[int, str, str, int]:
            mn_text = translations[i] if i < len(translations) else segments_in[i].text
            if _bracket_only.match(mn_text):
                return i, mn_text, "", 0
            try:
                audio_bytes = synthesize(mn_text, {"gender": request.gender})
                audio_ms = audio_duration_ms_from_bytes(audio_bytes)
                audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "/process ✗ TTS failed for segment %d/%d (%s: %s) text=%r",
                    i, total, type(exc).__name__, exc, mn_text[:120],
                )
                audio_b64, audio_ms = "", 0
            return i, mn_text, audio_b64, audio_ms

        with ThreadPoolExecutor(max_workers=12) as pool:
            futures = {pool.submit(_tts_one, i): i for i in range(total)}
            for future in as_completed(futures):
                i, mn_text, audio_b64, audio_ms = future.result()
                if not audio_b64:
                    tts_failures += 1
                seg = segments_in[i]
                logger.debug(
                    "/process → segment %d/%d: offset=%.2f dur=%.2f audio_ms=%d translated=%r",
                    i, total, seg.start, seg.duration, audio_ms, mn_text[:80],
                )
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

        logger.info(
            "/process → done: %d segments streamed, %d TTS failures (video_id=%s)",
            total,
            tts_failures,
            request.video_id,
        )

        if request.video_id:
            try:
                cache_video(request.video_id, {"source_lang": request.source_lang, "segments": [
                    {"start": s.start, "duration": s.duration, "text": s.text,
                     "source": "youtube_captions",
                     "translated_text": translations[i] if i < len(translations) else s.text}
                    for i, s in enumerate(segments_in)
                ]})
            except Exception:
                logger.warning("/process cache_video failed (non-fatal)", exc_info=True)

        yield _sse({"done": True, "total": total})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class DubRequest(BaseModel):
    video_id: str | None = None
    source_lang: str = "en"
    segments: list[SegmentInput] = []


@router.post("/api/dub")
async def dub_video(request: DubRequest):
    """Chrome extension endpoint — same pipeline as /process but returns plain JSON
    (not SSE) so the extension can call response.json() directly."""
    if not request.segments:
        raise HTTPException(status_code=400, detail="No segments provided.")

    segments_in = request.segments
    total = len(segments_in)

    logger.info("/api/dub ← video_id=%s segments=%d", request.video_id, total)

    translations = translate_timed(
        [(seg.text, seg.duration) for seg in segments_in], request.source_lang
    )

    translated_segments = []
    for i, seg in enumerate(segments_in):
        mn_text = translations[i] if i < len(translations) else seg.text
        try:
            audio_bytes = synthesize(mn_text)
            audio_ms = audio_duration_ms_from_bytes(audio_bytes)
            audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
        except Exception:
            logger.exception("/api/dub TTS failed segment %d", i)
            audio_b64, audio_ms = "", 0

        translated_segments.append({
            "start": seg.start,
            "duration": seg.duration,
            "text": seg.text,
            "translated_text": mn_text,
            "audio_b64": audio_b64,
            "audio_ms": audio_ms,
        })

    if request.video_id:
        try:
            cache_video(request.video_id, {"source_lang": request.source_lang, "segments": [
                {"start": s["start"], "duration": s["duration"],
                 "text": s["text"],
                 "source": "youtube_captions",
                 "translated_text": s["translated_text"]}
                for s in translated_segments
            ]})
        except Exception:
            logger.warning("/api/dub cache_video failed (non-fatal)", exc_info=True)

    logger.info("/api/dub → done: %d segments (video_id=%s)", total, request.video_id)
    return {"translated_segments": translated_segments, "audio_url": None}


@router.post("/summary")
async def get_summary(request: SummaryRequest):
    existing = get_latest_summary(request.video_id)
    if existing:
        return {"video_id": request.video_id, "summary": existing.summary_text}

    cached = get_cached_video(request.video_id)
    if not cached:
        raise HTTPException(
            status_code=404,
            detail="Video not processed yet. Call POST /process first.",
        )

    segments = [Segment(**s) for s in cached.get("segments", [])]
    summary_text = summarize(segments)
    save_summary(
        user_id=None,
        payload=SummaryCreate(video_id=request.video_id, summary_text=summary_text, model_name="gemini-1.5-flash"),
    )
    return {"video_id": request.video_id, "summary": summary_text}

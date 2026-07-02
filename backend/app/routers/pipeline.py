"""Streaming dub pipeline.

The YouTube transcript is fetched CLIENT-SIDE (Vercel /api/youtube/transcript)
because datacenter IPs get blocked by YouTube. The client POSTs the raw segments
here; we batch-translate them to Mongolian (duration-aware) and run TTS per
segment, streaming each finished segment back over SSE with inline base64 audio
so the UI can play it like a live dub.
"""

import base64
import hashlib
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.utils.audio import audio_duration_ms_from_bytes
from app.services.translator import (
    TRANSLATION_CACHE_VERSION,
    TimedText,
    TranslatedSegment,
    translate_timed_segments,
)
from app.services.tts_service import EmptyTextError, synthesize
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
    translated_text: str | None = None


class ProcessRequest(BaseModel):
    video_id: str | None = None
    source_lang: str = "en"
    segments: list[SegmentInput] = []
    gender: str = "female"
    voice: str | None = None  # Azure voice ID e.g. "mn-MN-BataaNeural"; overrides gender
    # When False, translate only (no TTS) — used to populate translated subtitles
    # without paying for audio synthesis. Dub mode sends tts=True.
    tts: bool = True


class SummaryRequest(BaseModel):
    video_id: str


def _sse(obj: dict) -> str:
    """Format one Server-Sent Events message."""
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _translation_mode(tts: bool) -> str:
    return "dub" if tts else "subtitle"


def _source_fingerprint(segments: list[SegmentInput]) -> str:
    payload = [
        {
            "start": round(segment.start, 3),
            "duration": round(segment.duration, 3),
            "text": segment.text.strip(),
        }
        for segment in segments
    ]
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _source_segment_dict(segment: SegmentInput) -> dict:
    return {
        "start": segment.start,
        "duration": segment.duration,
        "text": segment.text,
        "source": "youtube_captions",
        "translated_text": None,
    }


def _translated_segment_dict(segment: TranslatedSegment) -> dict:
    return {
        "start": segment.start,
        "duration": segment.duration,
        "text": segment.text,
        "source": "youtube_captions",
        "translated_text": segment.translated_text,
    }


def _translated_segment_from_cache(data: dict) -> TranslatedSegment | None:
    text = str(data.get("text") or "").strip()
    translated_text = str(data.get("translated_text") or "").strip()
    if not text or not translated_text:
        return None
    return TranslatedSegment(
        start=float(data.get("start") or 0),
        duration=float(data.get("duration") or 0),
        text=text,
        translated_text=translated_text,
    )


def _incoming_translated_segments(segments: list[SegmentInput]) -> list[TranslatedSegment] | None:
    if not segments:
        return None
    translated_segments: list[TranslatedSegment] = []
    for segment in segments:
        translated_text = (segment.translated_text or "").strip()
        if not translated_text:
            return None
        translated_segments.append(
            TranslatedSegment(
                start=segment.start,
                duration=segment.duration,
                text=segment.text,
                translated_text=translated_text,
            )
        )
    return translated_segments


def _voice_cache_key(voice: str | None, gender: str | None) -> str:
    # Voice ID (e.g. "mn-MN-BataaNeural") is what actually selects the TTS voice,
    # so it must key the audio cache; gender is only a legacy fallback.
    voice_id = (voice or "").strip()
    if voice_id:
        return voice_id
    value = (gender or "").strip().lower()
    return "male" if value == "male" else "female"


def _cached_translation_segments(
    video_id: str | None, segments: list[SegmentInput], mode: str
) -> list[TranslatedSegment] | None:
    if not video_id:
        return None

    cached = get_cached_video(video_id)
    translations = cached.get("translations") if isinstance(cached, dict) else None
    entry = translations.get(mode) if isinstance(translations, dict) else None
    if not isinstance(entry, dict):
        return None

    if entry.get("version") != TRANSLATION_CACHE_VERSION:
        return None

    if entry.get("source_fingerprint") != _source_fingerprint(segments):
        return None

    cached_segments = entry.get("segments") or []
    if not isinstance(cached_segments, list):
        return None

    translated_segments: list[TranslatedSegment] = []
    for cached_segment in cached_segments:
        if not isinstance(cached_segment, dict):
            return None
        translated_segment = _translated_segment_from_cache(cached_segment)
        if not translated_segment:
            return None
        translated_segments.append(translated_segment)

    return translated_segments or None


def _cached_dub_audio_segments(
    video_id: str | None,
    source_segments: list[SegmentInput],
    voice: str | None,
    gender: str | None,
) -> list[dict] | None:
    if not video_id:
        return None

    cached = get_cached_video(video_id)
    translations = cached.get("translations") if isinstance(cached, dict) else None
    entry = translations.get("dub") if isinstance(translations, dict) else None
    if not isinstance(entry, dict):
        return None
    if entry.get("version") != TRANSLATION_CACHE_VERSION:
        return None
    if entry.get("source_fingerprint") != _source_fingerprint(source_segments):
        return None

    tts_cache = entry.get("tts")
    if not isinstance(tts_cache, dict):
        return None
    voice_entry = tts_cache.get(_voice_cache_key(voice, gender))
    if not isinstance(voice_entry, dict):
        return None
    if voice_entry.get("version") != TRANSLATION_CACHE_VERSION:
        return None

    cached_segments = voice_entry.get("segments")
    if not isinstance(cached_segments, list) or not cached_segments:
        return None

    out: list[dict] = []
    for cached_segment in cached_segments:
        if not isinstance(cached_segment, dict):
            return None
        audio_b64 = cached_segment.get("audio_b64")
        audio_ms = cached_segment.get("audio_ms")
        translated_segment = _translated_segment_from_cache(cached_segment)
        if not translated_segment or not isinstance(audio_b64, str):
            return None
        try:
            audio_ms_int = int(audio_ms or 0)
        except (TypeError, ValueError):
            return None
        out.append(
            {
                **_translated_segment_dict(translated_segment),
                "audio_b64": audio_b64,
                "audio_ms": audio_ms_int,
            }
        )

    return out


def _cache_translation_segments(
    video_id: str | None,
    source_lang: str,
    source_segments: list[SegmentInput],
    translated_segments: list[TranslatedSegment],
    mode: str,
) -> None:
    if not video_id:
        return

    current = get_cached_video(video_id) or {}
    translations = current.get("translations") if isinstance(current.get("translations"), dict) else {}
    translations = dict(translations)
    source_fingerprint = _source_fingerprint(source_segments)
    existing_entry = translations.get(mode) if isinstance(translations.get(mode), dict) else {}
    same_source = (
        existing_entry.get("version") == TRANSLATION_CACHE_VERSION
        and existing_entry.get("source_fingerprint") == source_fingerprint
    )
    translations[mode] = {
        **(existing_entry if same_source else {}),
        "version": TRANSLATION_CACHE_VERSION,
        "source_fingerprint": source_fingerprint,
        "segments": [_translated_segment_dict(segment) for segment in translated_segments],
    }

    cache_video(
        video_id,
        {
            **current,
            "video_id": video_id,
            "source_lang": source_lang,
            "segments": current.get("segments")
            or [_source_segment_dict(segment) for segment in source_segments],
            "translations": translations,
        },
    )


def _cache_dub_audio_segments(
    video_id: str | None,
    source_lang: str,
    source_segments: list[SegmentInput],
    translated_segments: list[TranslatedSegment],
    audio_segments: list[dict],
    voice: str | None,
    gender: str | None,
) -> None:
    if not video_id:
        return

    current = get_cached_video(video_id) or {}
    translations = current.get("translations") if isinstance(current.get("translations"), dict) else {}
    translations = dict(translations)
    source_fingerprint = _source_fingerprint(source_segments)
    existing_entry = translations.get("dub") if isinstance(translations.get("dub"), dict) else {}
    same_source = (
        existing_entry.get("version") == TRANSLATION_CACHE_VERSION
        and existing_entry.get("source_fingerprint") == source_fingerprint
    )
    tts_cache = existing_entry.get("tts") if same_source and isinstance(existing_entry.get("tts"), dict) else {}
    tts_cache = dict(tts_cache)
    tts_cache[_voice_cache_key(voice, gender)] = {
        "version": TRANSLATION_CACHE_VERSION,
        "audio_format": "mp3-base64",
        "segments": audio_segments,
    }
    translations["dub"] = {
        **(existing_entry if same_source else {}),
        "version": TRANSLATION_CACHE_VERSION,
        "source_fingerprint": source_fingerprint,
        "segments": [_translated_segment_dict(segment) for segment in translated_segments],
        "tts": tts_cache,
    }

    cache_video(
        video_id,
        {
            **current,
            "video_id": video_id,
            "source_lang": source_lang,
            "segments": current.get("segments")
            or [_source_segment_dict(segment) for segment in source_segments],
            "translations": translations,
        },
    )


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
        input_total = len(segments_in)
        mode = _translation_mode(request.tts)

        # 1. Translate merged sentence/groups up front. This intentionally does
        # not preserve 1:1 caption alignment because YouTube captions often split
        # a single sentence into several fragments.
        translated_segments = _cached_translation_segments(request.video_id, segments_in, mode)
        if translated_segments:
            logger.info(
                "/process %s translation cache hit: %d grouped segments (video_id=%s)",
                mode,
                len(translated_segments),
                request.video_id,
            )
        else:
            translated_segments = (
                _incoming_translated_segments(segments_in) if request.tts else None
            )
            if translated_segments:
                logger.info(
                    "/process using incoming translated subtitles for dub: %d segments (video_id=%s)",
                    len(translated_segments),
                    request.video_id,
                )
            else:
                logger.info(
                    "/process translating %d source segments as %s groups (lang=%s)",
                    input_total,
                    mode,
                    request.source_lang,
                )
                try:
                    translated_segments = translate_timed_segments(
                        [
                            TimedText(start=seg.start, duration=seg.duration, text=seg.text)
                            for seg in segments_in
                        ],
                        request.source_lang,
                        fit_durations=request.tts,
                    )
                    logger.info(
                        "/process translation ok: %d grouped translations returned",
                        len(translated_segments),
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.exception(
                        "/process ✗ translation failed (video_id=%s, segments=%d)",
                        request.video_id,
                        input_total,
                    )
                    yield _sse({"error": f"translation failed: {type(exc).__name__}: {exc}"})
                    return

        # Translate-only fast path (subtitles): stream the translated text with no
        # audio, then finish. Avoids the cost/latency of TTS when no dub is needed.
        if not request.tts:
            total = len(translated_segments)
            for i, seg in enumerate(translated_segments):
                yield _sse(
                    {
                        "index": i,
                        "total": total,
                        "segment": {
                            "offset": seg.start,
                            "duration": seg.duration,
                            "text": seg.text,
                            "translated_text": seg.translated_text,
                            "audio_b64": "",
                            "audio_ms": 0,
                        },
                    }
                )
            if request.video_id:
                try:
                    _cache_translation_segments(
                        request.video_id,
                        request.source_lang,
                        segments_in,
                        translated_segments,
                        mode,
                    )
                except Exception:
                    logger.warning("/process cache_video failed (non-fatal)", exc_info=True)
            logger.info(
                "/process → done (translate-only): %d grouped segments (video_id=%s)",
                total,
                request.video_id,
            )
            yield _sse({"done": True, "total": total})
            return

        # 2. TTS in parallel — all segments at once, stream each as it finishes.
        # Frontend places segments by index so out-of-order delivery is fine.
        # CHANGED: log the dubbing (vocalizing) stage so progress is traceable.
        total = len(translated_segments)

        cached_audio_segments = _cached_dub_audio_segments(
            request.video_id,
            segments_in,
            request.voice,
            request.gender,
        )
        if cached_audio_segments:
            logger.info(
                "/process TTS audio cache hit: %d segments voice=%s (video_id=%s)",
                len(cached_audio_segments),
                _voice_cache_key(request.voice, request.gender),
                request.video_id,
            )
            for i, cached_segment in enumerate(cached_audio_segments):
                yield _sse(
                    {
                        "index": i,
                        "total": len(cached_audio_segments),
                        "segment": {
                            "offset": cached_segment["start"],
                            "duration": cached_segment["duration"],
                            "text": cached_segment["text"],
                            "translated_text": cached_segment["translated_text"],
                            "audio_b64": cached_segment["audio_b64"],
                            "audio_ms": cached_segment["audio_ms"],
                        },
                    }
                )
            yield _sse({"done": True, "total": len(cached_audio_segments)})
            return

        logger.info("/process stage=dubbing (TTS) %d segments (video_id=%s)", total, request.video_id)
        tts_failures = 0
        audio_results: list[dict | None] = [None] * total

        _bracket_only = re.compile(r"^\s*(\[.*?\]\s*)+$")

        def _tts_one(i: int) -> tuple[int, str, str, int, bool]:
            mn_text = translated_segments[i].translated_text or ""
            # Bracket-only segments ([Music], [Applause]) and blank text are
            # intentionally silent — not a TTS failure, so they must not block
            # caching or count as errors.
            if not mn_text.strip() or _bracket_only.match(mn_text):
                return i, mn_text, "", 0, False
            try:
                audio_bytes = synthesize(mn_text, {"voice": request.voice, "gender": request.gender})
                audio_ms = audio_duration_ms_from_bytes(audio_bytes)
                audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
            except EmptyTextError:
                # Defensive: synthesize() reports this on blank input we didn't
                # catch above. Treat as silent, not a failure.
                return i, mn_text, "", 0, False
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "/process ✗ TTS failed for segment %d/%d (%s: %s) text=%r",
                    i, total, type(exc).__name__, exc, mn_text[:120],
                )
                return i, mn_text, "", 0, True
            return i, mn_text, audio_b64, audio_ms, False

        with ThreadPoolExecutor(max_workers=12) as pool:
            futures = {pool.submit(_tts_one, i): i for i in range(total)}
            for future in as_completed(futures):
                i, mn_text, audio_b64, audio_ms, failed = future.result()
                if failed:
                    tts_failures += 1
                seg = translated_segments[i]
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
                audio_results[i] = {
                    **_translated_segment_dict(seg),
                    "audio_b64": audio_b64,
                    "audio_ms": audio_ms,
                }

        logger.info(
            "/process → done: %d segments streamed, %d TTS failures (video_id=%s)",
            total,
            tts_failures,
            request.video_id,
        )

        if request.video_id:
            try:
                _cache_translation_segments(
                    request.video_id,
                    request.source_lang,
                    segments_in,
                    translated_segments,
                    mode,
                )
                if tts_failures == 0 and all(result is not None for result in audio_results):
                    _cache_dub_audio_segments(
                        request.video_id,
                        request.source_lang,
                        segments_in,
                        translated_segments,
                        [result for result in audio_results if result is not None],
                        request.voice,
                        request.gender,
                    )
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
    gender: str = "female"


@router.post("/api/dub")
async def dub_video(request: DubRequest):
    """Chrome extension endpoint — same pipeline as /process but returns plain JSON
    (not SSE) so the extension can call response.json() directly."""
    if not request.segments:
        raise HTTPException(status_code=400, detail="No segments provided.")

    segments_in = request.segments
    input_total = len(segments_in)
    mode = "dub"

    logger.info("/api/dub ← video_id=%s segments=%d", request.video_id, input_total)

    translated = _cached_translation_segments(request.video_id, segments_in, mode)
    if translated:
        logger.info(
            "/api/dub translation cache hit: %d grouped segments (video_id=%s)",
            len(translated),
            request.video_id,
        )
    else:
        translated = _incoming_translated_segments(segments_in)
        if translated:
            logger.info(
                "/api/dub using incoming translated subtitles: %d segments (video_id=%s)",
                len(translated),
                request.video_id,
            )
        else:
            translated = translate_timed_segments(
                [
                    TimedText(start=seg.start, duration=seg.duration, text=seg.text)
                    for seg in segments_in
                ],
                request.source_lang,
                fit_durations=True,
            )

    cached_audio_segments = _cached_dub_audio_segments(
        request.video_id,
        segments_in,
        None,
        request.gender,
    )
    if cached_audio_segments:
        logger.info(
            "/api/dub TTS audio cache hit: %d segments gender=%s (video_id=%s)",
            len(cached_audio_segments),
            _voice_cache_key(None, request.gender),
            request.video_id,
        )
        return {"translated_segments": cached_audio_segments, "audio_url": None}

    translated_segments = []
    tts_failures = 0
    _bracket_only = re.compile(r"^\s*(\[.*?\]\s*)+$")
    for i, seg in enumerate(translated):
        mn_text = seg.translated_text or ""
        # Blank text or bracket-only ([Music], etc.) is intentionally silent.
        if not mn_text.strip() or _bracket_only.match(mn_text):
            audio_b64, audio_ms = "", 0
        else:
            try:
                audio_bytes = synthesize(mn_text, {"gender": request.gender})
                audio_ms = audio_duration_ms_from_bytes(audio_bytes)
                audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
            except EmptyTextError:
                audio_b64, audio_ms = "", 0
            except Exception:
                logger.exception("/api/dub TTS failed segment %d", i)
                audio_b64, audio_ms = "", 0
                tts_failures += 1

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
            _cache_translation_segments(
                request.video_id,
                request.source_lang,
                segments_in,
                translated,
                mode,
            )
            if tts_failures == 0:
                _cache_dub_audio_segments(
                    request.video_id,
                    request.source_lang,
                    segments_in,
                    translated,
                    translated_segments,
                    None,
                    request.gender,
                )
        except Exception:
            logger.warning("/api/dub cache_video failed (non-fatal)", exc_info=True)

    logger.info("/api/dub → done: %d grouped segments (video_id=%s)", len(translated), request.video_id)
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

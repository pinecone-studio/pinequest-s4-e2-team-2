"""Dub orchestration — the brain of the async pipeline.

start_dub:  cache/dedup check → transcript → translate → spawn GPU → return job
poll_dub:   check the GPU call; when done, store audio to storage + mark the job done

The GPU never runs inside a web request: start_dub returns as soon as the work is
queued; the client polls poll_dub (GET /jobs/{id}) until status == done.
"""

import base64
import logging

from app.config import MAX_DUB_SEGMENTS, MAX_TRANSCRIPT_CHARS
from app.models.dub_job import DubJob, DubSegment, DubStatus
from app.services import gpu_tts_client, job_service, storage_service
from app.services.transcript_service import fetch_transcript
from app.services.translator import translate_timed

logger = logging.getLogger(__name__)


class DubError(Exception):
    """Raised for client-facing failures (bad input, guardrail hit)."""


def start_dub(
    video_id: str,
    target_lang: str = "mn",
    voice_ref: str | None = None,
    ref_audio_b64: str | None = None,
    ref_text: str = "",
    segments: list[dict] | None = None,
    source_lang: str = "en",
) -> DubJob:
    cache_key = job_service.make_cache_key(video_id, target_lang, voice_ref)

    # 1. Cache hit → return the finished job, no GPU. (rule 4)
    cached = job_service.get_cached_result(cache_key)
    if cached:
        logger.info("dub cache hit: %s", cache_key)
        return cached

    # 2. Already in flight → return that job, no double work. (rule 5)
    inflight = job_service.find_inflight(cache_key)
    if inflight:
        logger.info("dub dedup: reusing in-flight job %s", inflight.id)
        return inflight

    # 3. Transcript: use client-supplied segments if given (skips RapidAPI — useful
    #    for testing or when the client already fetched them); else fetch via RapidAPI.
    if segments is None:
        segments, source_lang = fetch_transcript(video_id)
    if not segments:
        raise DubError("No transcript available for this video.")

    # 4. Cost guardrails — reject runaway inputs BEFORE spending GPU time. (rule 8)
    if len(segments) > MAX_DUB_SEGMENTS:
        raise DubError(f"Video too long: {len(segments)} segments (max {MAX_DUB_SEGMENTS}).")
    total_chars = sum(len(s["text"]) for s in segments)
    if total_chars > MAX_TRANSCRIPT_CHARS:
        raise DubError(f"Transcript too long: {total_chars} chars (max {MAX_TRANSCRIPT_CHARS}).")

    # 5. Translate to Mongolian (duration-aware so the dub fits each segment).
    translations = translate_timed(
        [(s["text"], s["duration"]) for s in segments], source_lang
    )
    dub_segments = [
        DubSegment(
            index=i,
            start=s["start"],
            duration=s["duration"],
            text=s["text"],
            translated_text=translations[i] if i < len(translations) else s["text"],
        )
        for i, s in enumerate(segments)
    ]

    # 6. Spawn GPU synthesis in the background. (async rule)
    call_id = gpu_tts_client.spawn_synthesis(
        [{"index": d.index, "text": d.translated_text or ""} for d in dub_segments],
        ref_audio_b64=ref_audio_b64,
        ref_text=ref_text,
    )

    # 7. Persist the job and return immediately.
    job = job_service.create_job(
        DubJob(
            cache_key=cache_key,
            video_id=video_id,
            target_lang=target_lang,
            voice_ref=voice_ref,
            status=DubStatus.PROCESSING,
            call_id=call_id,
            segments=dub_segments,
        )
    )
    logger.info("dub started: job=%s segments=%d", job.id, len(dub_segments))
    return job


def poll_dub(job: DubJob) -> DubJob:
    """Advance a job: if the GPU finished, store audio + mark done. Idempotent."""
    if job.status in (DubStatus.DONE, DubStatus.FAILED):
        return job
    if not job.call_id:
        return job

    try:
        result = gpu_tts_client.get_result(job.call_id)
    except Exception as exc:  # noqa: BLE001 — GPU/Modal failure
        logger.exception("dub GPU call failed: job=%s", job.id)
        job.status = DubStatus.FAILED
        job.error = f"{type(exc).__name__}: {exc}"
        return job_service.update_job(job)

    if result is None:
        return job  # still running — poll again later

    # GPU done → upload each segment's audio, fill URLs.
    by_index = {r["index"]: r for r in result}
    for seg in job.segments:
        r = by_index.get(seg.index)
        if r and r.get("audio_b64"):
            audio_bytes = base64.b64decode(r["audio_b64"])
            seg.audio_url = storage_service.store_audio(job.cache_key, seg.index, audio_bytes)
            seg.audio_ms = r.get("audio_ms") or 0

    job.status = DubStatus.DONE
    job.progress = 100
    logger.info("dub done: job=%s", job.id)
    return job_service.update_job(job)

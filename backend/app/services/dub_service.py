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

# Segments per GPU call. Smaller = first audio arrives sooner (more chunks);
# Modal may run chunks on parallel containers.
_CHUNK_SIZE = 8
# The FIRST chunk is tiny so the very first audio is playable ASAP; the rest use
# the larger _CHUNK_SIZE for efficiency.
_FIRST_CHUNK_SIZE = 3


def _chunk_ranges(n: int) -> list[tuple[int, int]]:
    """(start, end) ranges: a small first chunk, then _CHUNK_SIZE chunks."""
    if n <= 0:
        return []
    ranges: list[tuple[int, int]] = []
    first = min(_FIRST_CHUNK_SIZE, n)
    ranges.append((0, first))
    i = first
    while i < n:
        ranges.append((i, min(i + _CHUNK_SIZE, n)))
        i += _CHUNK_SIZE
    return ranges


class DubError(Exception):
    """Raised for client-facing failures (bad input, guardrail hit)."""


def start_dub(
    video_id: str,
    target_lang: str = "mn",
    voice_ref: str | None = None,
    ref_audio_b64: str | None = None,
    ref_text: str = "",
    ref_start: float | None = None,
    ref_duration: float | None = None,
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

    # 6. Spawn GPU synthesis in CHUNKS so audio arrives incrementally — the first
    #    chunk's audio is playable while later chunks are still synthesizing (and
    #    Modal can run chunks in parallel containers). (async rule)
    calls: list[dict] = []
    for start_i, end_i in _chunk_ranges(len(dub_segments)):
        chunk = dub_segments[start_i:end_i]
        call_id = gpu_tts_client.spawn_synthesis(
            [{"index": d.index, "text": d.translated_text or ""} for d in chunk],
            ref_audio_b64=ref_audio_b64,
            ref_text=ref_text,
            ref_start=ref_start,
            ref_duration=ref_duration,
            voice=voice_ref,
        )
        calls.append({"call_id": call_id, "indices": [d.index for d in chunk], "done": False})

    # 7. Persist the job and return immediately.
    job = job_service.create_job(
        DubJob(
            cache_key=cache_key,
            video_id=video_id,
            target_lang=target_lang,
            voice_ref=voice_ref,
            status=DubStatus.PROCESSING,
            calls=calls,
            segments=dub_segments,
        )
    )
    logger.info("dub started: job=%s segments=%d chunks=%d", job.id, len(dub_segments), len(calls))
    return job


def poll_dub(job: DubJob) -> DubJob:
    """Advance a job incrementally: for every finished chunk, store its audio and
    fill those segments' URLs. Done when all chunks complete. Idempotent."""
    if job.status in (DubStatus.DONE, DubStatus.FAILED) or not job.calls:
        return job

    by_index = {seg.index: seg for seg in job.segments}
    changed = False

    for call in job.calls:
        if call.get("done"):
            continue
        try:
            result = gpu_tts_client.get_result(call["call_id"])
        except Exception as exc:  # noqa: BLE001 — one chunk's GPU call failed
            logger.exception("dub chunk failed: job=%s call=%s", job.id, call.get("call_id"))
            call["done"] = True
            call["error"] = f"{type(exc).__name__}: {exc}"
            changed = True
            continue
        if result is None:
            continue  # this chunk is still synthesizing

        for r in result:
            seg = by_index.get(r["index"])
            if seg and r.get("audio_b64"):
                audio_bytes = base64.b64decode(r["audio_b64"])
                seg.audio_url = storage_service.store_audio(job.cache_key, seg.index, audio_bytes)
                seg.audio_ms = r.get("audio_ms") or 0
        call["done"] = True
        changed = True

    filled = sum(1 for seg in job.segments if seg.audio_url)
    job.progress = int(filled / max(1, len(job.segments)) * 100)
    if all(call.get("done") for call in job.calls):
        job.status = DubStatus.DONE
        job.progress = 100
        logger.info("dub done: job=%s (%d/%d segments)", job.id, filled, len(job.segments))

    return job_service.update_job(job) if changed or job.status == DubStatus.DONE else job

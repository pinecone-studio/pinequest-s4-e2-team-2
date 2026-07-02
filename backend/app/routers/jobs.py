"""Async dub API — the F5 voice-over entry point.

  POST /jobs        → create (or reuse) a dub job; returns immediately with job_id
  GET  /jobs/{id}   → poll status; when done, includes per-segment audio URLs

The GPU runs in the background (Modal); these endpoints never block on it.
"""

import re
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.models.entities import UserProfile
from app.models.dub_job import DubJob
from app.services import dub_service, job_service
from app.services.auth_service import get_current_user
from app.services.dub_service import DubError
from app.services.entitlement_service import require_video_access

router = APIRouter(prefix="/jobs", tags=["dub"])

_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,20}$")

# Minimal in-process rate limit (rule: protect against runaway job submission).
# NOTE: per-process only — a multi-instance deployment needs a shared store (Redis).
_RATE_MAX = 20          # jobs
_RATE_WINDOW = 60       # seconds
_hits: dict[str, list[float]] = defaultdict(list)


def _rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    recent = [t for t in _hits[ip] if now - t < _RATE_WINDOW]
    if len(recent) >= _RATE_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please wait a moment.",
        )
    recent.append(now)
    _hits[ip] = recent


class CreateJobRequest(BaseModel):
    video_id: str
    target_lang: str = "mn"
    voice_ref: str | None = None       # voice identity (None = default fixed voice)
    ref_audio_b64: str | None = None   # optional reference clip for voice cloning
    ref_text: str = ""                 # transcript of the ref ("" → auto via Whisper)
    # Optional: supply transcript directly to skip the RapidAPI fetch
    # (client already has it, or for testing). [{start, duration, text}]
    segments: list[dict] | None = None
    source_lang: str = "en"


@router.post("", response_model=DubJob, status_code=status.HTTP_202_ACCEPTED)
def create_job(
    req: CreateJobRequest,
    request: Request,
    current_user: UserProfile = Depends(get_current_user),
) -> DubJob:
    _rate_limit(request)

    video_id = req.video_id.strip()
    if not _VIDEO_ID_RE.match(video_id):
        raise HTTPException(status_code=400, detail="Invalid video_id.")
    require_video_access(current_user, video_id, req.target_lang)

    try:
        return dub_service.start_dub(
            video_id=video_id,
            target_lang=req.target_lang,
            voice_ref=req.voice_ref,
            ref_audio_b64=req.ref_audio_b64,
            ref_text=req.ref_text,
            segments=req.segments,
            source_lang=req.source_lang,
        )
    except DubError as exc:
        # Expected, client-facing failures (no transcript, too long, …).
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — upstream (RapidAPI/OpenAI/Modal) error
        raise HTTPException(
            status_code=502, detail=f"Dub pipeline error: {type(exc).__name__}"
        ) from exc


@router.get("/{job_id}", response_model=DubJob)
def read_job(
    job_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> DubJob:
    job = job_service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    require_video_access(current_user, job.video_id, job.target_lang)
    try:
        return dub_service.poll_dub(job)
    except Exception as exc:  # noqa: BLE001 — surface the real error for debugging
        raise HTTPException(status_code=500, detail=f"Poll error: {type(exc).__name__}: {exc}") from exc

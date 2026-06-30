"""Async dub job + result models (the new F5 voice-over pipeline).

One DubJob represents one (video, language, voice) request. Its `segments` carry
the translated text and — once the GPU finishes — the per-segment audio URLs.
"""

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class DubStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class DubSegment(BaseModel):
    index: int
    start: float
    duration: float
    text: str                              # original (source-language) line
    translated_text: str | None = None     # Mongolian
    audio_url: str | None = None           # filled when GPU result is stored
    audio_ms: int | None = None


class DubJob(BaseModel):
    id: str | None = None
    cache_key: str                         # hash(video_id + lang + voice_ref)
    video_id: str
    target_lang: str = "mn"
    voice_ref: str | None = None           # voice identity for caching (None = default)
    status: DubStatus = DubStatus.QUEUED
    progress: int = Field(default=0, ge=0, le=100)
    call_id: str | None = None             # Modal FunctionCall id to poll
    segments: list[DubSegment] = []
    error: str | None = None
    created_at: datetime = Field(default_factory=_utc_now)
    updated_at: datetime = Field(default_factory=_utc_now)

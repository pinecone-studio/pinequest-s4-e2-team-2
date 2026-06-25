from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JobState(BaseModel):
    """Lightweight job state used by the synchronous dub pipeline."""

    youtube_id: str
    status: Literal["pending", "processing", "done", "error"]
    error: str | None = None


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class JobStep(str, Enum):
    METADATA = "metadata"
    CAPTION = "caption"
    TRANSLATE = "translate"
    SUMMARY = "summary"
    TTS = "tts"
    STORAGE = "storage"


class ProcessingJob(BaseModel):
    """Rich Firestore-backed job record (schema branch)."""

    id: str | None = None
    user_id: str
    video_id: str
    status: JobStatus = JobStatus.QUEUED
    step: JobStep = JobStep.METADATA
    progress: int = Field(default=0, ge=0, le=100)
    error_message: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

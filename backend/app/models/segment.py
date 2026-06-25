from enum import Enum
from typing import Literal

from pydantic import BaseModel


class SegmentSource(str, Enum):
    """Future-facing source enum (schema branch). Pipeline currently uses the
    string literals on ``Segment.source`` directly."""

    YOUTUBE_CAPTIONS = "youtube_captions"
    WHISPER = "whisper"
    TRANSLATED = "translated"


class Segment(BaseModel):
    start: float
    duration: float
    text: str
    source: Literal["youtube_captions", "whisper"]
    translated_text: str | None = None
    audio_path: str | None = None
    audio_ms: int | None = None

    # Schema-branch extensions — populated by future speaker detection /
    # multi-language work. Optional so the existing dub pipeline keeps working.
    language_code: str | None = None
    speaker_label: str | None = None

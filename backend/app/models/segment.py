from pydantic import BaseModel
from typing import Literal


class Segment(BaseModel):
    start: float
    duration: float
    text: str
    source: Literal["youtube_captions", "whisper"]
    translated_text: str | None = None
    audio_path: str | None = None
    audio_ms: int | None = None

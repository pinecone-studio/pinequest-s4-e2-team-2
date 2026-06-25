from pydantic import BaseModel
from typing import Literal


class JobState(BaseModel):
    youtube_id: str
    status: Literal["pending", "processing", "done", "error"]
    error: str | None = None

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.cache_service import get_cached_video
from app.services.summary_service import summarize
from app.models.segment import Segment

router = APIRouter()


class SummaryRequest(BaseModel):
    video_id: str


@router.post("/summary")
async def get_summary(request: SummaryRequest):
    cached = get_cached_video(request.video_id)
    if not cached:
        raise HTTPException(
            status_code=404,
            detail="Video not processed yet. Call POST /process first.",
        )

    segments = [Segment(**s) for s in cached.get("segments", [])]
    summary = summarize(segments)
    return {"video_id": request.video_id, "summary": summary}

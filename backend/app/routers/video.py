from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models.entities import (
    NoteCreate,
    NoteRecord,
    NoteUpdate,
    ProcessVideoRequest,
    UserProfile,
    VideoAssetCreate,
    VideoAssetRecord,
    VideoRecord,
    VideoTranscriptCache,
    VideoUpsert,
    WatchHistoryRecord,
    WatchHistoryUpdate,
)
from app.models.job import ProcessingJob
from app.config import get_settings
from app.services import cache_service
from app.services.auth_service import get_current_user


router = APIRouter(prefix="/videos", tags=["videos"])


def _service_unavailable(exc: Exception) -> HTTPException:
    detail = "Data service is temporarily unavailable."
    if get_settings().environment == "local":
        detail = f"{detail} {type(exc).__name__}: {exc}"
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)


@router.post("", response_model=VideoRecord)
def upsert_video(
    payload: VideoUpsert,
    current_user: UserProfile = Depends(get_current_user),
) -> VideoRecord:
    return cache_service.upsert_video(payload)


@router.post("/process", response_model=ProcessingJob, status_code=status.HTTP_202_ACCEPTED)
def create_processing_job(
    payload: ProcessVideoRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> ProcessingJob:
    video = cache_service.upsert_video(payload.video)
    job = ProcessingJob(user_id=current_user.id, video_id=video.id)
    return cache_service.create_processing_job(job)


@router.get("/jobs/{job_id}", response_model=ProcessingJob)
def read_processing_job(
    job_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> ProcessingJob:
    job = cache_service.get_processing_job(job_id)
    if not job or job.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return job


@router.post("/history", response_model=WatchHistoryRecord)
def update_watch_history(
    payload: WatchHistoryUpdate,
    current_user: UserProfile = Depends(get_current_user),
) -> WatchHistoryRecord:
    try:
        return cache_service.record_watch_history(current_user.id, payload)
    except Exception as exc:
        raise _service_unavailable(exc) from exc


@router.get("/history", response_model=list[WatchHistoryRecord])
def list_watch_history(
    limit: int = Query(default=30, ge=1, le=100),
    current_user: UserProfile = Depends(get_current_user),
) -> list[WatchHistoryRecord]:
    try:
        return cache_service.list_watch_history(current_user.id, limit=limit)
    except Exception as exc:
        raise _service_unavailable(exc) from exc


@router.get("/{video_id}/transcript", response_model=VideoTranscriptCache)
def read_video_transcript(
    video_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> VideoTranscriptCache:
    try:
        transcript = cache_service.get_video_transcript(video_id)
    except Exception as exc:
        raise _service_unavailable(exc) from exc

    if not transcript:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transcript not cached.")
    return transcript


@router.put("/{video_id}/transcript", response_model=VideoTranscriptCache)
def save_video_transcript(
    video_id: str,
    payload: VideoTranscriptCache,
    current_user: UserProfile = Depends(get_current_user),
) -> VideoTranscriptCache:
    if payload.video_id != video_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path video_id must match request body video_id.",
        )
    try:
        return cache_service.save_video_transcript(payload)
    except Exception as exc:
        raise _service_unavailable(exc) from exc


@router.post("/{video_id}/notes", response_model=NoteRecord, status_code=status.HTTP_201_CREATED)
def create_note(
    video_id: str,
    payload: NoteCreate,
    current_user: UserProfile = Depends(get_current_user),
) -> NoteRecord:
    if payload.video_id != video_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path video_id must match request body video_id.",
        )
    try:
        return cache_service.create_note(current_user.id, payload)
    except Exception as exc:
        raise _service_unavailable(exc) from exc


@router.get("/{video_id}/notes", response_model=list[NoteRecord])
def list_notes(
    video_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> list[NoteRecord]:
    try:
        return cache_service.list_notes(current_user.id, video_id)
    except Exception as exc:
        raise _service_unavailable(exc) from exc


@router.post("/{video_id}/assets", response_model=VideoAssetRecord, status_code=status.HTTP_201_CREATED)
def save_video_asset(
    video_id: str,
    payload: VideoAssetCreate,
    current_user: UserProfile = Depends(get_current_user),
) -> VideoAssetRecord:
    if payload.video_id != video_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path video_id must match request body video_id.",
        )
    return cache_service.save_video_asset(payload)


@router.get("/{video_id}/assets", response_model=list[VideoAssetRecord])
def list_video_assets(
    video_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> list[VideoAssetRecord]:
    return cache_service.list_video_assets(video_id)


@router.patch("/notes/{note_id}", response_model=NoteRecord)
def update_note(
    note_id: str,
    payload: NoteUpdate,
    current_user: UserProfile = Depends(get_current_user),
) -> NoteRecord:
    try:
        return cache_service.update_note(current_user.id, note_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.") from exc


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: str,
    current_user: UserProfile = Depends(get_current_user),
) -> None:
    try:
        cache_service.delete_note(current_user.id, note_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.") from exc

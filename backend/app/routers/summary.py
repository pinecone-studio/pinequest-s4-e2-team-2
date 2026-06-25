from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models.entities import (
    ChatMessageCreate,
    ChatMessageRecord,
    ChatSessionCreate,
    ChatSessionRecord,
    SummaryCreate,
    SummaryRecord,
    SummarySearchResult,
    UserProfile,
)
from app.services import cache_service
from app.services.auth_service import get_current_user


router = APIRouter(prefix="/summaries", tags=["summaries"])


@router.post("", response_model=SummaryRecord, status_code=status.HTTP_201_CREATED)
def save_summary(
    payload: SummaryCreate,
    current_user: UserProfile = Depends(get_current_user),
) -> SummaryRecord:
    return cache_service.save_summary(current_user.id, payload)


@router.get("/search", response_model=list[SummarySearchResult])
def search_summaries(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: UserProfile = Depends(get_current_user),
) -> list[SummarySearchResult]:
    return cache_service.search_summaries(current_user.id, q, limit=limit)


@router.post("/chat/sessions", response_model=ChatSessionRecord, status_code=status.HTTP_201_CREATED)
def create_chat_session(
    payload: ChatSessionCreate,
    current_user: UserProfile = Depends(get_current_user),
) -> ChatSessionRecord:
    return cache_service.create_chat_session(current_user.id, payload)


@router.post(
    "/chat/sessions/{session_id}/messages",
    response_model=ChatMessageRecord,
    status_code=status.HTTP_201_CREATED,
)
def append_chat_message(
    session_id: str,
    payload: ChatMessageCreate,
    current_user: UserProfile = Depends(get_current_user),
) -> ChatMessageRecord:
    try:
        return cache_service.append_chat_message(current_user.id, session_id, payload)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat session not found.",
        ) from exc


@router.get("/chat/sessions/{session_id}/messages", response_model=list[ChatMessageRecord])
def list_chat_messages(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    current_user: UserProfile = Depends(get_current_user),
) -> list[ChatMessageRecord]:
    try:
        return cache_service.list_chat_messages(current_user.id, session_id, limit=limit)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat session not found.",
        ) from exc


@router.get("/{video_id}/latest", response_model=SummaryRecord)
def read_latest_summary(
    video_id: str,
    language_code: str = Query(default="mn", min_length=2, max_length=12),
    current_user: UserProfile = Depends(get_current_user),
) -> SummaryRecord:
    summary = cache_service.get_latest_summary(video_id, language_code=language_code)
    if not summary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Summary not found.")
    return summary

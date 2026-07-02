from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.models.entities import UserProfile
from app.services.auth_service import get_current_user
from app.services.assistant_service import (
    AssistantMode,
    AssistantRequestData,
    AssistantSegment,
    answer_assistant,
)
from app.services.entitlement_service import require_pro


router = APIRouter(prefix="/assistant", tags=["assistant"])


class AssistantChatRequest(BaseModel):
    mode: AssistantMode
    question: str | None = None
    video_id: str | None = None
    current_time: float | None = None
    segments: list[AssistantSegment] = []


class AssistantChatResponse(BaseModel):
    mode: AssistantMode
    answer: str


@router.post("/chat", response_model=AssistantChatResponse)
def assistant_chat(
    request: AssistantChatRequest,
    current_user: UserProfile = Depends(get_current_user),
) -> AssistantChatResponse:
    require_pro(current_user)
    if request.mode == "question" and not (request.question or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="question is required for question mode.",
        )

    try:
        answer = answer_assistant(AssistantRequestData(**request.model_dump()))
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Assistant failed: {type(exc).__name__}",
        ) from exc

    return AssistantChatResponse(mode=request.mode, answer=answer)

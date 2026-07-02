from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.models.entities import UserProfile
from app.services.auth_service import get_current_user
from app.services.entitlement_service import require_pro
from app.services.translator import translate

router = APIRouter()


class TranslateRequest(BaseModel):
    text: str
    source_lang: str = "en"
    target_lang: str = "mn"


@router.post("/translate")
def translate_text(
    request: TranslateRequest,
    current_user: UserProfile = Depends(get_current_user),
):
    require_pro(current_user)
    translated = translate(request.text, request.source_lang, request.target_lang)
    return {"translated": translated}

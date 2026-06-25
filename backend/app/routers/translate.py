from fastapi import APIRouter
from pydantic import BaseModel

from app.services.translator import translate

router = APIRouter()


class TranslateRequest(BaseModel):
    text: str
    source_lang: str = "en"
    target_lang: str = "mn"


@router.post("/translate")
def translate_text(request: TranslateRequest):
    translated = translate(request.text, request.source_lang, request.target_lang)
    return {"translated": translated}

import google.generativeai as genai
from app.config import GEMINI_API_KEY
from app.models.segment import Segment

genai.configure(api_key=GEMINI_API_KEY)
_model = genai.GenerativeModel("gemini-1.5-flash")


def translate(text: str, source_lang: str, target_lang: str) -> str:
    prompt = (
        f"Translate the following text from {source_lang} to {target_lang}. "
        f"Return ONLY the translated text, no explanations.\n\n{text}"
    )
    response = _model.generate_content(prompt)
    return response.text.strip()


def to_mongolian(segments: list[Segment], source_lang: str) -> list[Segment]:
    """
    Translates segment texts to Mongolian, preserving start/duration.

    English source  → one step:  en → mn
    Any other source → two steps: source → en (Google pivot), en → mn
    """
    result = []
    for seg in segments:
        if source_lang == "en":
            mn_text = translate(seg.text, "en", "mn")
        else:
            en_text = translate(seg.text, source_lang, "en")
            mn_text = translate(en_text, "en", "mn")
        result.append(seg.model_copy(update={"translated_text": mn_text}))
    return result

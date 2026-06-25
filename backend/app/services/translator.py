import os

from app.models.segment import Segment

PROVIDER = os.getenv("TRANSLATION_PROVIDER", "openai")


def _openai_translate(text: str, source_lang: str, target_lang: str) -> str:
    from openai import OpenAI
    from app.config import OPENAI_API_KEY

    client = OpenAI(api_key=OPENAI_API_KEY)
    model = os.getenv("OPENAI_TRANSLATION_MODEL", "gpt-4o-mini")
    prompt = (
        f"Translate the following text from {source_lang} to {target_lang}. "
        f"Return ONLY the translated text, no explanations.\n\n{text}"
    )
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content.strip()


def _gemini_translate(text: str, source_lang: str, target_lang: str) -> str:
    import google.generativeai as genai
    from app.config import GEMINI_API_KEY

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-1.5-flash")
    prompt = (
        f"Translate the following text from {source_lang} to {target_lang}. "
        f"Return ONLY the translated text, no explanations.\n\n{text}"
    )
    response = model.generate_content(prompt)
    return response.text.strip()


def translate(text: str, source_lang: str, target_lang: str) -> str:
    if PROVIDER == "gemini":
        return _gemini_translate(text, source_lang, target_lang)
    return _openai_translate(text, source_lang, target_lang)


def to_mongolian(segments: list[Segment], source_lang: str) -> list[Segment]:
    result = []
    for seg in segments:
        if source_lang == "en":
            mn_text = translate(seg.text, "en", "mn")
        else:
            en_text = translate(seg.text, source_lang, "en")
            mn_text = translate(en_text, "en", "mn")
        result.append(seg.model_copy(update={"translated_text": mn_text}))
    return result

import json
import logging
import os

from app.models.segment import Segment

logger = logging.getLogger(__name__)

PROVIDER = os.getenv("TRANSLATION_PROVIDER", "openai")
_DEFAULT_BATCH_SIZE = int(os.getenv("TRANSLATION_BATCH_SIZE", "40"))
# Rough natural Mongolian TTS pace; used to cap translation length so the dubbed
# line fits inside the segment's on-screen duration.
_CHARS_PER_SEC = float(os.getenv("TRANSLATION_CHARS_PER_SEC", "13"))


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
    """Single-string translation (used by routers/translate.py)."""
    if PROVIDER == "gemini":
        return _gemini_translate(text, source_lang, target_lang)
    return _openai_translate(text, source_lang, target_lang)


def _openai_translate_batch(texts: list[str], source_lang: str, target_lang: str) -> list[str]:
    """Translate many strings in ONE API call. Returns a list aligned 1:1 with
    `texts`. On any failure or length mismatch it falls back to the originals,
    so the pipeline never aborts mid-way."""
    from openai import OpenAI
    from app.config import OPENAI_API_KEY

    client = OpenAI(api_key=OPENAI_API_KEY)
    model = os.getenv("OPENAI_TRANSLATION_MODEL", "gpt-4o-mini")
    prompt = (
        f"Translate each string in this JSON array from {source_lang} to {target_lang}. "
        f'Respond with ONLY a JSON object {{"translations": [...]}} whose array contains '
        f"exactly {len(texts)} strings, in the same order as the input.\n\n"
        f"{json.dumps(texts, ensure_ascii=False)}"
    )
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)
    out = data.get("translations") or []
    if len(out) != len(texts):
        logger.error(
            "translation batch size mismatch: got %d, expected %d", len(out), len(texts)
        )
        out = (list(out) + texts)[: len(texts)]  # align by padding with originals
    return [str(item) for item in out]


def _openai_translate_batch_timed(
    items: list[tuple[str, float]], source_lang: str, target_lang: str
) -> list[str]:
    """Duration-aware batch translate. `items` = (text, duration_seconds). Each
    translation is capped to roughly fit its spoken duration so the dub doesn't
    overrun the segment. Falls back to originals on mismatch."""
    from openai import OpenAI
    from app.config import OPENAI_API_KEY

    client = OpenAI(api_key=OPENAI_API_KEY)
    model = os.getenv("OPENAI_TRANSLATION_MODEL", "gpt-4o-mini")
    payload = [
        {"text": text, "max_chars": max(1, round(duration * _CHARS_PER_SEC))}
        for text, duration in items
    ]
    prompt = (
        f"You are dubbing subtitles from {source_lang} to {target_lang}. Translate "
        f"each item's `text`. Every line is spoken aloud and must fit its on-screen "
        f"time, so keep the {target_lang} translation natural but NO LONGER than about "
        f"`max_chars` characters — compress/shorten the wording rather than overrun. "
        f'Respond with ONLY a JSON object {{"translations": [...]}} containing exactly '
        f"{len(items)} strings, in the same order.\n\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)
    out = data.get("translations") or []
    if len(out) != len(items):
        logger.error("timed translation mismatch: got %d, expected %d", len(out), len(items))
        out = (list(out) + [text for text, _ in items])[: len(items)]
    return [str(item) for item in out]


def translate_timed(
    items: list[tuple[str, float]], source_lang: str, batch_size: int | None = None
) -> list[str]:
    """Translate (text, duration_seconds) pairs to Mongolian in batches, fitting
    each translation to its duration. Returns translations aligned 1:1."""
    if not items:
        return []
    size = batch_size or _DEFAULT_BATCH_SIZE
    out: list[str] = []
    for start in range(0, len(items), size):
        chunk = items[start : start + size]
        try:
            out.extend(_openai_translate_batch_timed(chunk, source_lang, "mn"))
        except Exception:
            logger.exception("timed translation batch failed; using original text")
            out.extend(text for text, _ in chunk)
    return out


def to_mongolian(
    segments: list[Segment], source_lang: str, batch_size: int | None = None
) -> list[Segment]:
    """Translate every segment's text to Mongolian in BATCHES — a handful of API
    calls instead of one (or two) per segment. Far fewer requests = safer/cheaper
    on a deployed server. A failed batch falls back to the original text."""
    if not segments:
        return []

    size = batch_size or _DEFAULT_BATCH_SIZE
    result: list[Segment] = []
    for start in range(0, len(segments), size):
        chunk = segments[start : start + size]
        texts = [seg.text for seg in chunk]
        try:
            translations = _openai_translate_batch(texts, source_lang, "mn")
        except Exception:
            logger.exception("translation batch failed; using original text for this chunk")
            translations = texts
        for seg, mn_text in zip(chunk, translations):
            result.append(seg.model_copy(update={"translated_text": mn_text}))
    return result

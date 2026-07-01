import json
import logging
import os
import re
from dataclasses import asdict, dataclass
from typing import Any, Iterable

logger = logging.getLogger(__name__)

PROVIDER = os.getenv("TRANSLATION_PROVIDER", "openai")
TRANSLATION_CACHE_VERSION = os.getenv("TRANSLATION_CACHE_VERSION", "sentence-v2")

_DEFAULT_BATCH_SIZE = int(os.getenv("TRANSLATION_BATCH_SIZE", "18"))
_CONTEXT_MAX_CHARS = int(os.getenv("TRANSLATION_CONTEXT_MAX_CHARS", "6500"))
_GROUP_MAX_GAP = float(os.getenv("TRANSLATION_GROUP_MAX_GAP", "1.15"))
_GROUP_MAX_DURATION = float(os.getenv("TRANSLATION_GROUP_MAX_DURATION", "16"))
_GROUP_MAX_CHARS = int(os.getenv("TRANSLATION_GROUP_MAX_CHARS", "420"))
_CHARS_PER_SEC = float(os.getenv("TRANSLATION_CHARS_PER_SEC", "13"))
_SENTENCE_END_RE = re.compile(r"""[.!?]["')\]\s]*$""")
_LATIN_WORD_RE = re.compile(r"\b[A-Za-z][A-Za-z'-]{2,}\b")

_DEFAULT_GLOSSARY: dict[str, str] = {
    "transcript": "бичвэр",
    "caption": "хадмал",
    "captions": "хадмал",
    "subtitle": "хадмал орчуулга",
    "subtitles": "хадмал орчуулга",
    "cache": "кэш",
    "pipeline": "дамжлага",
    "translate": "орчуулах",
    "translation": "орчуулга",
    "video": "видео",
    "audio": "аудио",
    "token": "токен",
    "tokens": "токен",
    "database": "өгөгдлийн сан",
    "backend": "backend",
    "frontend": "frontend",
}

_COMMON_ENGLISH_LEFTOVERS = {
    "about",
    "after",
    "again",
    "also",
    "because",
    "before",
    "between",
    "caption",
    "captions",
    "change",
    "data",
    "database",
    "doing",
    "done",
    "during",
    "example",
    "from",
    "have",
    "here",
    "into",
    "like",
    "make",
    "need",
    "only",
    "process",
    "really",
    "right",
    "same",
    "should",
    "subtitle",
    "subtitles",
    "than",
    "that",
    "their",
    "there",
    "these",
    "thing",
    "this",
    "through",
    "translate",
    "translation",
    "transcript",
    "using",
    "video",
    "what",
    "when",
    "where",
    "which",
    "with",
    "without",
    "would",
}

_ALLOWED_LATIN_WORDS = {
    "api",
    "backend",
    "css",
    "env",
    "frontend",
    "html",
    "http",
    "https",
    "json",
    "llm",
    "next",
    "openai",
    "rapidapi",
    "react",
    "sql",
    "tts",
    "ui",
    "url",
    "ux",
}


@dataclass(frozen=True)
class TimedText:
    start: float
    duration: float
    text: str


@dataclass(frozen=True)
class TranslatedSegment:
    start: float
    duration: float
    text: str
    translated_text: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class _TextGroup:
    id: int
    start: float
    duration: float
    text: str
    source_indices: list[int]


def _openai_translate(text: str, source_lang: str, target_lang: str) -> str:
    from openai import OpenAI
    from app.config import OPENAI_API_KEY

    client = OpenAI(api_key=OPENAI_API_KEY)
    model = os.getenv("OPENAI_TRANSLATION_MODEL", "gpt-4o-mini")
    prompt = (
        f"Translate the following text from {source_lang} to {target_lang}. "
        "Return ONLY the translated text, no explanations. Use Mongolian Cyrillic "
        "when the target language is Mongolian. Translate ordinary English words; "
        "keep only proper nouns, acronyms, URLs, code identifiers, and product names in Latin.\n\n"
        f"{text}"
    )
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    return response.choices[0].message.content.strip()


def _gemini_translate(text: str, source_lang: str, target_lang: str) -> str:
    import google.generativeai as genai
    from app.config import GEMINI_API_KEY

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-1.5-flash")
    prompt = (
        f"Translate the following text from {source_lang} to {target_lang}. "
        "Return ONLY the translated text, no explanations.\n\n"
        f"{text}"
    )
    response = model.generate_content(prompt)
    return response.text.strip()


def translate(text: str, source_lang: str, target_lang: str) -> str:
    """Single-string translation used by routers/translate.py."""
    if PROVIDER == "gemini":
        return _gemini_translate(text, source_lang, target_lang)
    return _openai_translate(text, source_lang, target_lang)


def _normalize_lang(lang: str) -> str:
    return (lang or "").strip().lower().split("-")[0]


def _ends_sentence(text: str) -> bool:
    return bool(_SENTENCE_END_RE.search(text.strip()))


def _load_glossary() -> dict[str, str]:
    raw = os.getenv("TRANSLATION_GLOSSARY_JSON")
    if not raw:
        return _DEFAULT_GLOSSARY
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("TRANSLATION_GLOSSARY_JSON is invalid; using default glossary")
        return _DEFAULT_GLOSSARY
    if not isinstance(parsed, dict):
        return _DEFAULT_GLOSSARY
    glossary = dict(_DEFAULT_GLOSSARY)
    glossary.update({str(key): str(value) for key, value in parsed.items()})
    return glossary


def _clean_join(parts: Iterable[str]) -> str:
    return re.sub(r"\s+", " ", " ".join(part.strip() for part in parts if part.strip())).strip()


def _coerce_timed_texts(items: list[TimedText | dict[str, Any] | tuple[str, float]]) -> list[TimedText]:
    out: list[TimedText] = []
    cursor = 0.0
    for item in items:
        if isinstance(item, TimedText):
            text = item.text.strip()
            if text:
                out.append(item)
            continue
        if isinstance(item, dict):
            text = str(item.get("text") or "").strip()
            start = float(item.get("start") or cursor)
            duration = float(item.get("duration") or 0)
        else:
            text = str(item[0] or "").strip()
            duration = float(item[1] or 0)
            start = cursor
        if not text:
            continue
        out.append(TimedText(start=start, duration=duration, text=text))
        cursor = max(cursor, start + duration)
    return out


def _build_sentence_groups(items: list[TimedText]) -> list[_TextGroup]:
    groups: list[_TextGroup] = []
    current: list[int] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        first = items[current[0]]
        last = items[current[-1]]
        end = max(last.start + last.duration, first.start + first.duration)
        groups.append(
            _TextGroup(
                id=len(groups),
                start=first.start,
                duration=max(0.05, end - first.start),
                text=_clean_join(items[index].text for index in current),
                source_indices=[*current],
            )
        )
        current = []

    for index, item in enumerate(items):
        if current:
            previous = items[current[-1]]
            gap = item.start - (previous.start + previous.duration)
            current_text = _clean_join(items[i].text for i in current)
            current_start = items[current[0]].start
            projected_chars = len(current_text) + len(item.text) + 1
            projected_duration = item.start + item.duration - current_start
            if (
                gap > _GROUP_MAX_GAP
                or projected_chars > _GROUP_MAX_CHARS
                or projected_duration > _GROUP_MAX_DURATION
            ):
                flush()

        current.append(index)

        if _ends_sentence(item.text):
            flush()

    flush()
    return groups


def _build_group_chunks(groups: list[_TextGroup], batch_size: int) -> list[list[_TextGroup]]:
    chunks: list[list[_TextGroup]] = []
    current: list[_TextGroup] = []
    current_chars = 0

    def flush() -> None:
        nonlocal current, current_chars
        if current:
            chunks.append(current)
        current = []
        current_chars = 0

    for group in groups:
        next_chars = len(group.text) + 1
        if current and (
            len(current) >= batch_size or current_chars + next_chars > _CONTEXT_MAX_CHARS
        ):
            flush()
        current.append(group)
        current_chars += next_chars

    flush()
    return chunks


def _group_payload(group: _TextGroup, fit_durations: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": group.id,
        "start": round(group.start, 3),
        "duration": round(group.duration, 3),
        "text": group.text,
    }
    if fit_durations:
        payload["max_chars"] = max(18, round(group.duration * _CHARS_PER_SEC))
    return payload


def _translations_by_id(data: Any, target_ids: set[int]) -> dict[int, str]:
    raw = data.get("translations") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return {}

    out: dict[int, str] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        raw_id = item.get("id")
        text = item.get("text") or item.get("translation")
        try:
            item_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if isinstance(text, str) and item_id in target_ids:
            out[item_id] = text.strip()
    return out


def _suspicious_latin_words(text: str) -> list[str]:
    suspicious: list[str] = []
    for match in _LATIN_WORD_RE.finditer(text):
        word = match.group(0)
        lowered = word.lower().strip("'")
        if lowered in _ALLOWED_LATIN_WORDS:
            continue
        if word.isupper() and len(word) <= 8:
            continue
        if any(char.isdigit() for char in word):
            continue
        if lowered in _COMMON_ENGLISH_LEFTOVERS or word == word.lower():
            suspicious.append(word)
    return suspicious


def _parse_json_object(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        logger.warning("translation model returned invalid JSON: %r", content[:500])
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _translation_prompt(
    groups: list[_TextGroup],
    source_lang: str,
    target_lang: str,
    fit_durations: bool,
) -> str:
    mode = "dub" if fit_durations else "subtitle"
    glossary = _load_glossary()
    if fit_durations:
        task = (
            "Translate each sentence/group into natural spoken Mongolian for dubbing. "
            "The input groups are already merged from broken caption fragments. "
            "Keep each translated line concise enough to speak within duration and "
            "near max_chars when possible, but do not drop important meaning."
        )
    else:
        task = (
            "Translate each sentence/group into natural Mongolian subtitles. The "
            "input groups are already merged from broken caption fragments, so do "
            "not split the translation back into the original caption fragments."
        )

    payload = {
        "source_lang": source_lang,
        "target_lang": target_lang,
        "mode": mode,
        "glossary": glossary,
        "groups": [_group_payload(group, fit_durations) for group in groups],
    }

    return (
        f"{task}\n\n"
        "Return ONLY valid JSON in this exact shape:\n"
        '{"translations":[{"id":0,"text":"..."}]}\n\n'
        "Rules:\n"
        "- Include exactly one object for every group id.\n"
        "- Keep ids as numbers and preserve chronological order.\n"
        "- Use Mongolian Cyrillic.\n"
        "- Translate all normal English words into natural Mongolian.\n"
        "- Keep Latin text ONLY for proper nouns, brand/product names, acronyms, URLs, "
        "code identifiers, API names, file paths, env vars, and command flags.\n"
        "- Do not leave common English words untranslated.\n"
        "- Apply the glossary where it fits naturally; do not over-literalize.\n"
        "- Rewrite for Mongolian word order; do not translate word by word.\n"
        "- Do not summarize, omit, explain, or add commentary.\n\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )


def _repair_prompt(
    groups: list[_TextGroup],
    translations: dict[int, str],
    source_lang: str,
    target_lang: str,
    fit_durations: bool,
) -> str:
    glossary = _load_glossary()
    payload = {
        "source_lang": source_lang,
        "target_lang": target_lang,
        "mode": "dub" if fit_durations else "subtitle",
        "glossary": glossary,
        "groups": [
            {
                **_group_payload(group, fit_durations),
                "current_translation": translations.get(group.id, ""),
                "suspicious_latin_words": _suspicious_latin_words(
                    translations.get(group.id, "")
                ),
            }
            for group in groups
        ],
    }
    return (
        "Repair these Mongolian translations. Some ordinary English words were "
        "left in Latin. Translate ordinary English into natural Mongolian Cyrillic. "
        "Keep Latin only for proper nouns, brands, acronyms, URLs, code identifiers, "
        "API names, file paths, env vars, and command flags.\n\n"
        "Return ONLY valid JSON in this exact shape:\n"
        '{"translations":[{"id":0,"text":"..."}]}\n\n'
        f"{json.dumps(payload, ensure_ascii=False)}"
    )


def _openai_translate_group_chunk(
    groups: list[_TextGroup],
    source_lang: str,
    target_lang: str,
    fit_durations: bool,
) -> dict[int, str]:
    from openai import OpenAI
    from app.config import OPENAI_API_KEY

    client = OpenAI(api_key=OPENAI_API_KEY)
    model = os.getenv("OPENAI_TRANSLATION_MODEL", "gpt-4o-mini")
    target_ids = {group.id for group in groups}

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a professional Mongolian audiovisual translator. "
                    "You produce natural Mongolian Cyrillic, not word-by-word English."
                ),
            },
            {"role": "user", "content": _translation_prompt(groups, source_lang, target_lang, fit_durations)},
        ],
        response_format={"type": "json_object"},
        temperature=0.15,
    )
    data = _parse_json_object(response.choices[0].message.content or "")
    translations = _translations_by_id(data, target_ids)

    suspicious_groups = [
        group for group in groups if _suspicious_latin_words(translations.get(group.id, ""))
    ]
    if suspicious_groups:
        logger.info(
            "repairing %d translations with suspicious Latin leftovers",
            len(suspicious_groups),
        )
        repair_response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You repair Mongolian translations by removing untranslated "
                        "ordinary English while preserving proper nouns and code terms."
                    ),
                },
                {
                    "role": "user",
                    "content": _repair_prompt(
                        suspicious_groups,
                        translations,
                        source_lang,
                        target_lang,
                        fit_durations,
                    ),
                },
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        repair_data = _parse_json_object(repair_response.choices[0].message.content or "")
        translations.update(_translations_by_id(repair_data, {group.id for group in suspicious_groups}))

    missing = target_ids.difference(translations)
    if missing:
        logger.error(
            "group translation missing ids: got=%s missing=%s",
            sorted(translations),
            sorted(missing),
        )
    return translations


def translate_timed_segments(
    items: list[TimedText | dict[str, Any] | tuple[str, float]],
    source_lang: str,
    batch_size: int | None = None,
    fit_durations: bool = True,
) -> list[TranslatedSegment]:
    """Translate timed captions after merging broken captions into sentence groups."""
    timed_items = _coerce_timed_texts(items)
    if not timed_items:
        return []

    groups = _build_sentence_groups(timed_items)
    if _normalize_lang(source_lang) == "mn":
        return [
            TranslatedSegment(
                start=group.start,
                duration=group.duration,
                text=group.text,
                translated_text=group.text,
            )
            for group in groups
        ]

    size = batch_size or _DEFAULT_BATCH_SIZE
    translated_by_id: dict[int, str] = {}
    for chunk in _build_group_chunks(groups, size):
        try:
            translated_by_id.update(
                _openai_translate_group_chunk(
                    chunk,
                    source_lang,
                    "mn",
                    fit_durations=fit_durations,
                )
            )
        except Exception:
            logger.exception(
                "group translation chunk failed; using original text for group ids %s",
                [group.id for group in chunk],
            )

    return [
        TranslatedSegment(
            start=group.start,
            duration=group.duration,
            text=group.text,
            translated_text=translated_by_id.get(group.id) or group.text,
        )
        for group in groups
    ]


def translate_timed(
    items: list[tuple[str, float]],
    source_lang: str,
    batch_size: int | None = None,
    fit_durations: bool = True,
) -> list[str]:
    """Compatibility wrapper. New callers should use translate_timed_segments."""
    return [
        segment.translated_text
        for segment in translate_timed_segments(
            items,
            source_lang,
            batch_size=batch_size,
            fit_durations=fit_durations,
        )
    ]

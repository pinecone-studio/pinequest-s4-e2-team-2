_ALIASES: dict[str, str] = {
    "en-us": "en",
    "en-gb": "en",
    "zh-hans": "zh",
    "zh-hant": "zh",
    "zh-cn": "zh",
    "zh-tw": "zh",
    "pt-br": "pt",
    "pt-pt": "pt",
}


def normalize(lang: str) -> str:
    """Normalize a language code to a 2-letter ISO 639-1 code."""
    key = lang.strip().lower()
    if key in _ALIASES:
        return _ALIASES[key]
    return key.split("-")[0]

import os
import xml.sax.saxutils as saxutils
import httpx
from app.config import AZURE_SPEECH_KEY, AZURE_SPEECH_REGION

# Switch providers: TTS_PROVIDER=azure|chimege
PROVIDER = os.getenv("TTS_PROVIDER", "azure")

_AZURE_VOICES = {
    "female": "mn-MN-YesuiNeural",
    "male": "mn-MN-BataaNeural",
}

# EXTENSION POINT: Coqui TTS adapter (mn-MN support limited — use Azure for MVP)


def synthesize(text: str, options: dict = None) -> bytes:
    """Return MP3 audio bytes for the given Mongolian text. Azure first, Chimege fallback."""
    opts = options or {}
    if PROVIDER == "chimege":
        return _chimege_synthesize(text, opts)
    try:
        return _azure_synthesize(text, opts)
    except Exception:
        return _chimege_synthesize(text, opts)


def _azure_synthesize(text: str, options: dict) -> bytes:
    gender = options.get("gender", "female")
    voice = _AZURE_VOICES.get(gender, _AZURE_VOICES["female"])

    safe_text = saxutils.escape(text)
    ssml = (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='mn-MN'>"
        f"<voice name='{voice}'>{safe_text}</voice>"
        "</speak>"
    )
    resp = httpx.post(
        f"https://{AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1",
        headers={
            "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        },
        content=ssml.encode("utf-8"),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.content


def _chimege_synthesize(text: str, options: dict) -> bytes:
    chimege_key = os.getenv("CHIMEGE_TTS_API_KEY", "")
    chimege_url = os.getenv("CHIMEGE_TTS_URL", "https://api.chimege.com/v1.0/synthesize")
    resp = httpx.post(chimege_url, headers={
        "Authorization": f"Bearer {chimege_key}",
        "Content-Type": "application/json",
    }, json={"text": text}, timeout=30)
    resp.raise_for_status()
    return resp.content

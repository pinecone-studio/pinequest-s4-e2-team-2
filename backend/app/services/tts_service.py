import logging
import os
import xml.sax.saxutils as saxutils
import httpx
from app.config import AZURE_SPEECH_KEY, AZURE_SPEECH_REGION

logger = logging.getLogger(__name__)

# Switch providers: TTS_PROVIDER=azure|chimege
PROVIDER = os.getenv("TTS_PROVIDER", "azure")

_AZURE_VOICES = {
    "female": "mn-MN-YesuiNeural",
    "male": "mn-MN-BataaNeural",
}
_VALID_VOICE_IDS = set(_AZURE_VOICES.values())


class EmptyTextError(ValueError):
    """Raised when synthesize() is called with blank text — the caller should
    treat this segment as silent, not a TTS failure."""


def synthesize(text: str, options: dict = None) -> bytes:
    """Return MP3 audio bytes for the given Mongolian text. Azure first, Chimege fallback.

    Raises EmptyTextError if text is blank so the caller can skip silent segments
    without logging them as errors.
    """
    if not text or not text.strip():
        raise EmptyTextError("empty text")
    opts = options or {}
    if PROVIDER == "chimege":
        return _chimege_synthesize(text, opts)
    try:
        return _azure_synthesize(text, opts)
    except Exception:
        # Only fall back when Chimege is actually configured; otherwise the
        # fallback's auth error would mask the real Azure failure.
        if os.getenv("CHIMEGE_TTS_API_KEY"):
            return _chimege_synthesize(text, opts)
        raise


def _resolve_voice(options: dict) -> str:
    """Pick a valid Azure voice ID from options, defaulting to male Batga.

    Unknown voice IDs are rejected (Azure would 400 with a cryptic error) rather
    than silently substituted, so callers see a clear failure.
    """
    requested = (options.get("voice") or "").strip()
    if requested:
        if requested not in _VALID_VOICE_IDS:
            raise ValueError(f"Unknown Azure voice ID: {requested!r}")
        return requested
    gender = (options.get("gender") or "male").strip().lower()
    return _AZURE_VOICES.get(gender, _AZURE_VOICES["male"])


def _azure_synthesize(text: str, options: dict) -> bytes:
    if not AZURE_SPEECH_KEY:
        raise RuntimeError(
            "AZURE_SPEECH_KEY is not set. Configure it in backend/.env before starting the server."
        )

    voice = _resolve_voice(options)
    rate = os.getenv("AZURE_TTS_RATE", "+30%")

    safe_text = saxutils.escape(text.strip())
    ssml = (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='mn-MN'>"
        f"<voice name='{voice}'><prosody rate='{rate}'>{safe_text}</prosody></voice>"
        "</speak>"
    )
    try:
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
    except httpx.HTTPError as exc:
        logger.error("Azure TTS network error voice=%s: %s", voice, exc)
        raise

    if resp.status_code >= 400:
        # Surface Azure's error body so we know why (bad key, quota, bad SSML, ...).
        body = resp.text[:400] if resp.text else "<empty body>"
        logger.error(
            "Azure TTS %d voice=%s len=%d: %s",
            resp.status_code, voice, len(safe_text), body,
        )
        resp.raise_for_status()

    if not resp.content:
        raise RuntimeError("Azure TTS returned empty audio body")
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

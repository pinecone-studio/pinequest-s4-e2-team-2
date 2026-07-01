"""YouTube transcript via RapidAPI 'youtube-transcriptor'.

RapidAPI scrapes from its OWN infrastructure, so this is NOT subject to the
YouTube datacenter IP-block that breaks in-house scraping on Render/Vercel.

Server-side mirror of web/src/lib/rapid-transcript.ts — both sides must stay on
the same provider, since they share a RapidAPI account/quota.
"""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

RAPID_HOST = os.getenv("RAPID_API_HOST", "youtube-transcriptor.p.rapidapi.com")
RAPID_KEY = os.getenv("RAPID_API_KEY", "")


def _num(value) -> float | None:
    try:
        n = float(value)
        return n if n == n else None  # reject NaN
    except (TypeError, ValueError):
        return None


def _to_segments(items: list[dict]) -> list[dict]:
    """Map raw items → {start, duration, text}. `dur` is the duration directly;
    fall back to (end - start) for the older provider shape."""
    segs: list[dict] = []
    for it in items:
        text = " ".join(str(it.get("subtitle") or it.get("text") or "").split()).strip()
        if not text:
            continue
        start = _num(it.get("start")) or 0.0
        dur = _num(it.get("dur"))
        explicit = _num(it.get("duration"))
        end = _num(it.get("end"))
        duration = dur if dur is not None else (explicit if explicit is not None else (end - start if end is not None else 0.0))
        if not duration or duration <= 0:
            duration = 0.0
        segs.append({"start": start, "duration": duration, "text": text})

    for i, seg in enumerate(segs):
        if not seg["duration"]:
            nxt = segs[i + 1] if i + 1 < len(segs) else None
            seg["duration"] = max(0.5, nxt["start"] - seg["start"]) if nxt else 2.0
    return segs


def fetch_transcript(video_id: str) -> tuple[list[dict], str]:
    """Return (segments, source_lang). Raises on misconfig or API failure."""
    if not RAPID_HOST or not RAPID_KEY:
        raise RuntimeError(
            "RapidAPI not configured: set RAPID_API_HOST and RAPID_API_KEY in the backend env."
        )

    resp = httpx.get(
        f"https://{RAPID_HOST}/transcript",
        params={"video_id": video_id, "lang": "en"},
        headers={
            "x-rapidapi-key": RAPID_KEY,
            "x-rapidapi-host": RAPID_HOST,
        },
        timeout=60,
    )
    resp.raise_for_status()
    body = resp.json()

    # The provider returns an array of one video object. Tolerate a bare
    # object too, just in case.
    video = body[0] if isinstance(body, list) else (body or {})
    items = video.get("transcription") or video.get("transcript") or []
    segments = _to_segments(items)
    source_lang = (video.get("availableLangs") or ["en"])[0]

    logger.info(
        "transcript fetched: video_id=%s lang=%s segments=%d", video_id, source_lang, len(segments)
    )
    return segments, source_lang

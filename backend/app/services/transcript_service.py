"""YouTube transcript via RapidAPI 'video-transcript-scraper'.

RapidAPI scrapes from its OWN infrastructure, so this is NOT subject to the
YouTube datacenter IP-block that breaks in-house scraping on Render/Vercel.

Server-side mirror of web/src/lib/rapid-transcript.ts — the orchestration layer
owns transcript fetching so the key stays server-side and the client only sends
a video_id.
"""

import logging
import os
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

RAPID_URL = os.getenv("RAPID_API_URL") or os.getenv("NEXT_PUBLIC_RAPID_API_URL", "")
RAPID_KEY = os.getenv("RAPIDAPI_KEY") or os.getenv("NEXT_PUBLIC_RAPID_API_KEY", "")


def _host() -> str:
    # RapidAPI requires x-rapidapi-host to match the endpoint host exactly.
    try:
        return urlparse(RAPID_URL).netloc or "video-transcript-scraper.p.rapidapi.com"
    except Exception:
        return "video-transcript-scraper.p.rapidapi.com"


def _num(value) -> float | None:
    try:
        n = float(value)
        return n if n == n else None  # reject NaN
    except (TypeError, ValueError):
        return None


def _to_segments(items: list[dict]) -> list[dict]:
    """Map raw items → {start, duration, text}. Duration from end-start; backfill
    any missing duration from the next segment's start."""
    segs: list[dict] = []
    for it in items:
        text = " ".join(str(it.get("text") or "").split()).strip()
        if not text:
            continue
        start = _num(it.get("start")) or 0.0
        end = _num(it.get("end"))
        explicit = _num(it.get("duration"))
        duration = explicit if explicit is not None else (end - start if end is not None else 0.0)
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
    if not RAPID_URL or not RAPID_KEY:
        raise RuntimeError(
            "RapidAPI not configured: set RAPID_API_URL and RAPIDAPI_KEY in the backend env."
        )

    resp = httpx.post(
        RAPID_URL,
        headers={
            "x-rapidapi-key": RAPID_KEY,
            "x-rapidapi-host": _host(),
            "Content-Type": "application/json",
        },
        json={"video_url": f"https://www.youtube.com/watch?v={video_id}"},
        timeout=60,
    )
    resp.raise_for_status()
    body = resp.json()

    data = body.get("data") or {}
    items = data.get("transcript") or body.get("transcript") or []
    segments = _to_segments(items)
    source_lang = (data.get("video_info") or {}).get("selected_language") or "en"

    logger.info(
        "transcript fetched: video_id=%s lang=%s segments=%d", video_id, source_lang, len(segments)
    )
    return segments, source_lang

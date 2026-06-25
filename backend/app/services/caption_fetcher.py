from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
from app.models.segment import Segment
from app.utils.lang import normalize

_api = YouTubeTranscriptApi()


def fetch_captions(video_id: str) -> tuple[str, list[Segment]] | None:
    """
    PATH A — YouTube caption татах.
    Returns (source_lang, segments) or None if no captions available.

    Language selection: English эхлээд; олдохгүй бол байгаа хэлийг авна.
    """
    try:
        transcript_list = _api.list(video_id)
    except (TranscriptsDisabled, Exception):
        return None

    source_lang = "en"
    try:
        transcript = transcript_list.find_transcript(["en"])
    except NoTranscriptFound:
        try:
            transcript = next(iter(transcript_list))
            source_lang = normalize(transcript.language_code)
        except StopIteration:
            return None

    try:
        data = transcript.fetch()
    except Exception:
        return None

    segments = [
        Segment(
            start=seg.start,
            duration=seg.duration,
            text=seg.text,
            source="youtube_captions",
        )
        for seg in data
    ]
    return source_lang, segments

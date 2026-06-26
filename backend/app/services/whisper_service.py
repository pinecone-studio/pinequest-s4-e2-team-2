import uuid
import os
from app.models.segment import Segment


def transcribe(url: str, language: str | None = None) -> tuple[str, list[Segment]]:
    """
    PATH B fallback — yt-dlp + faster-whisper.
    Downloads audio then transcribes locally.
    Returns (detected_lang, segments).

    Caller contract: only call this after the youtube_transcript_api caption
    path (caption_fetcher.fetch_captions) has failed. Downloading audio is
    what triggers YouTube's bot-detection block on datacenter IPs (e.g.
    Render) — captions can still resolve from those same IPs, so they must
    stay the primary path. pipeline.process_video already enforces this
    ordering; this is the only caller of transcribe().
    """
    audio_path = _download_audio(url)
    try:
        return _transcribe_audio(audio_path, language)
    finally:
        if os.path.exists(audio_path):
            os.unlink(audio_path)


def _download_audio(url: str) -> str:
    import yt_dlp

    output_path = f"tmp/audio_{uuid.uuid4().hex}"
    os.makedirs("tmp", exist_ok=True)
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_path,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
        }],
        "quiet": True,
    }
    cookies_file = os.getenv("YTDLP_COOKIES_FILE")
    if cookies_file:
        ydl_opts["cookiefile"] = cookies_file
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    return output_path + ".mp3"


def _transcribe_audio(file_path: str, language: str | None) -> tuple[str, list[Segment]]:
    from faster_whisper import WhisperModel

    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments_iter, info = model.transcribe(file_path, beam_size=5, language=language)

    segments = [
        Segment(
            start=round(seg.start, 2),
            duration=round(seg.end - seg.start, 2),
            text=seg.text.strip(),
            source="whisper",
        )
        for seg in segments_iter
    ]
    return info.language, segments

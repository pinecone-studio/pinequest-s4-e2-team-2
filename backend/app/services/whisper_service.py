import uuid
import os
from app.models.segment import Segment


def transcribe(url: str, language: str | None = None) -> tuple[str, list[Segment]]:
    """
    PATH B fallback — yt-dlp + faster-whisper.
    Downloads audio then transcribes locally.
    Returns (detected_lang, segments).
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

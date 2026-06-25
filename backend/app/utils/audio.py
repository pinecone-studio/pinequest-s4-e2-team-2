import os
from app.config import AUDIO_DIR


def save_audio(audio_bytes: bytes, video_id: str, segment_index: int) -> str:
    dir_path = os.path.join(AUDIO_DIR, video_id)
    os.makedirs(dir_path, exist_ok=True)
    file_path = os.path.join(dir_path, f"segment_{segment_index}.mp3")
    with open(file_path, "wb") as f:
        f.write(audio_bytes)
    return file_path


def audio_url_path(video_id: str, segment_index: int) -> str:
    return f"/audio/{video_id}/segment_{segment_index}.mp3"


def audio_duration_ms(file_path: str) -> int:
    """Return audio duration in milliseconds using mutagen (lightweight)."""
    try:
        from mutagen.mp3 import MP3
        return int(MP3(file_path).info.length * 1000)
    except Exception:
        return 0

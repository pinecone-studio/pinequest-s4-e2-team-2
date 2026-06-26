import io
import os
from app.config import AUDIO_DIR


def save_audio(audio_bytes: bytes, video_id: str, segment_index: int) -> str:
    """Upload to Firebase Storage, return public URL."""
    from app.services.firebase_service import get_storage_bucket

    bucket = get_storage_bucket()
    blob_path = f"audio/{video_id}/segment_{segment_index}.mp3"
    blob = bucket.blob(blob_path)
    blob.upload_from_string(audio_bytes, content_type="audio/mpeg")
    blob.make_public()
    return blob.public_url


def audio_url_path(video_id: str, segment_index: int) -> str:
    """Kept for compatibility but no longer used in pipeline."""
    return f"/audio/{video_id}/segment_{segment_index}.mp3"


def audio_duration_ms_from_bytes(audio_bytes: bytes) -> int:
    """Calculate duration from raw bytes before uploading."""
    try:
        from mutagen.mp3 import MP3
        return int(MP3(io.BytesIO(audio_bytes)).info.length * 1000)
    except Exception:
        return 0


def audio_duration_ms(file_path: str) -> int:
    """Legacy local file fallback — kept so nothing else breaks."""
    try:
        from mutagen.mp3 import MP3
        if os.path.exists(file_path):
            return int(MP3(file_path).info.length * 1000)
        return 0
    except Exception:
        return 0
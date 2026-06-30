"""Audio storage seam.

Today: Firebase Storage (already configured for this project). Tomorrow: swap to
Cloudflare R2 / S3 by changing ONLY this file — callers use store_audio() and
never see the backend. Keeping this seam clean is why the rest of the code stays
storage-agnostic.
"""


def store_audio(cache_key: str, index: int, audio_bytes: bytes, ext: str = "wav") -> str:
    """Upload one segment's audio and return its public URL.

    Path is namespaced by cache_key (= hash(video+lang+voice)) so identical dub
    requests reuse the same objects instead of regenerating them.
    """
    from app.services.firebase_service import get_storage_bucket

    bucket = get_storage_bucket()
    blob = bucket.blob(f"dub/{cache_key}/seg_{index}.{ext}")
    blob.upload_from_string(audio_bytes, content_type=f"audio/{ext}")
    blob.make_public()
    return blob.public_url

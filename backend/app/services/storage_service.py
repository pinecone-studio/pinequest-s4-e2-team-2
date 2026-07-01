"""Audio storage seam — Cloudflare R2 (S3-compatible).

Callers use store_audio() and never see the backend, so swapping storage means
changing ONLY this file. R2 is chosen for cheap, egress-free object storage.

Env (see .env.example):
  R2_ACCOUNT_ID         - Cloudflare account id
  R2_ACCESS_KEY_ID      - R2 API token access key
  R2_SECRET_ACCESS_KEY  - R2 API token secret
  R2_BUCKET             - bucket name
  R2_PUBLIC_BASE_URL    - public base URL of the bucket (r2.dev dev URL or custom
                          domain), e.g. https://pub-xxxx.r2.dev
"""

import os
from functools import lru_cache

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.getenv("R2_BUCKET", "")
R2_PUBLIC_BASE_URL = os.getenv("R2_PUBLIC_BASE_URL", "").rstrip("/")


@lru_cache(maxsize=1)
def _client():
    import boto3  # imported lazily so the rest of the app loads without boto3

    if not (R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_BUCKET):
        raise RuntimeError(
            "R2 not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, "
            "R2_SECRET_ACCESS_KEY, R2_BUCKET (and R2_PUBLIC_BASE_URL)."
        )
    return boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def store_audio(cache_key: str, index: int, audio_bytes: bytes, ext: str = "wav") -> str:
    """Upload one segment's audio to R2 and return its public URL.

    Path is namespaced by cache_key (= hash(video+lang+voice)) so identical dub
    requests reuse the same objects instead of regenerating them.
    """
    key = f"dub/{cache_key}/seg_{index}.{ext}"
    _client().put_object(
        Bucket=R2_BUCKET,
        Key=key,
        Body=audio_bytes,
        ContentType=f"audio/{ext}",
    )
    return f"{R2_PUBLIC_BASE_URL}/{key}"

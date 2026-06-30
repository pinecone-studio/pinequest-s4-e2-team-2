"""Dub job store + cache + dedup (Firestore-backed).

Reuses the project's existing Firestore client (no new DB for the MVP). Three
jobs of this layer:
  • cache (rule 4): a finished job for a cache_key is reused — no GPU re-run.
  • dedup  (rule 5): an in-flight job for a cache_key is reused — no double work.
  • state          : create / read / update job records the router polls.

cache_key = hash(video_id + target_lang + voice_ref) — the identity of a dub.
"""

import hashlib
from typing import Any
from uuid import uuid4

from app.models.dub_job import DubJob, DubStatus
from app.services.firebase_service import get_firestore_client

_COLLECTION = "dub_jobs"
_ACTIVE = (DubStatus.QUEUED.value, DubStatus.PROCESSING.value)


def make_cache_key(video_id: str, target_lang: str, voice_ref: str | None) -> str:
    raw = f"{video_id}|{target_lang}|{voice_ref or 'default'}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def _col():
    return get_firestore_client().collection(_COLLECTION)


def _dump(job: DubJob) -> dict[str, Any]:
    # mode="json" → enums become strings, datetimes ISO — safe for Firestore.
    return job.model_dump(mode="json")


def create_job(job: DubJob) -> DubJob:
    job.id = uuid4().hex
    _col().document(job.id).set(_dump(job))
    return job


def get_job(job_id: str) -> DubJob | None:
    snap = _col().document(job_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    data["id"] = snap.id
    return DubJob(**data)


def update_job(job: DubJob) -> DubJob:
    from datetime import datetime, timezone

    job.updated_at = datetime.now(timezone.utc)
    _col().document(job.id).set(_dump(job))
    return job


def get_cached_result(cache_key: str) -> DubJob | None:
    """A completed job for this cache_key, if any (cache hit → skip the GPU)."""
    query = (
        _col()
        .where("cache_key", "==", cache_key)
        .where("status", "==", DubStatus.DONE.value)
        .limit(1)
    )
    for doc in query.stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        return DubJob(**data)
    return None


def find_inflight(cache_key: str) -> DubJob | None:
    """A queued/processing job for this cache_key, if any (dedup → reuse it)."""
    query = (
        _col()
        .where("cache_key", "==", cache_key)
        .where("status", "in", list(_ACTIVE))
        .limit(1)
    )
    for doc in query.stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        return DubJob(**data)
    return None

from datetime import datetime, timezone
import json
import os
import threading
from typing import Any
from uuid import uuid4

from pydantic import BaseModel

from app.models.entities import (
    ChatMessageCreate,
    ChatMessageRecord,
    ChatSessionCreate,
    ChatSessionRecord,
    NoteCreate,
    NoteRecord,
    NoteUpdate,
    SummaryCreate,
    SummaryRecord,
    SummarySearchResult,
    TranscriptSegmentRecord,
    UserProfile,
    VideoTranscriptCache,
    VideoAssetCreate,
    VideoAssetRecord,
    VideoRecord,
    VideoUpsert,
    VoiceProfileCreate,
    VoiceProfileRecord,
    WatchHistoryRecord,
    WatchHistoryUpdate,
)
from app.models.job import ProcessingJob
from app.services.firebase_service import get_firestore_client

_USER_STORE_LOCKS: dict[str, threading.RLock] = {}
_USER_STORE_LOCKS_GUARD = threading.RLock()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _dump(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_none=True)
    return model.dict(exclude_none=True)


def _doc_to_dict(snapshot: Any) -> dict[str, Any] | None:
    if not snapshot.exists:
        return None

    data = snapshot.to_dict() or {}
    data["id"] = snapshot.id
    return data


def _stream_to_models(model: type[BaseModel], stream: Any) -> list[Any]:
    records = []
    for doc in stream:
        data = doc.to_dict() or {}
        data.setdefault("id", doc.id)
        records.append(model(**data))
    return records


def _query_stream(query: Any, timeout: int = 10) -> Any:
    try:
        return query.stream(timeout=timeout)
    except TypeError:
        return query.stream()


def _use_local_user_store() -> bool:
    value = os.getenv("SIGHTAHEAD_LOCAL_USER_STORE")
    if value is not None:
        return value.strip().lower() not in {"0", "false", "no"}
    return get_settings().environment == "local"


def _safe_user_id(user_id: str) -> str:
    return "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in user_id)


def _local_user_path(user_id: str) -> str:
    return os.path.join(CACHE_DIR, "users", f"{_safe_user_id(user_id)}.json")


def _local_user_lock(user_id: str) -> threading.RLock:
    safe_id = _safe_user_id(user_id)
    with _USER_STORE_LOCKS_GUARD:
        if safe_id not in _USER_STORE_LOCKS:
            _USER_STORE_LOCKS[safe_id] = threading.RLock()
        return _USER_STORE_LOCKS[safe_id]


def _empty_local_user_data() -> dict[str, Any]:
    return {"history": {}, "notes": {}}


def _normalize_local_user_data(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return _empty_local_user_data()
    if not isinstance(data.get("history"), dict):
        data["history"] = {}
    if not isinstance(data.get("notes"), dict):
        data["notes"] = {}
    return data


def _read_json_with_trailing_recovery(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        raw = f.read()

    stripped = raw.lstrip()
    if not stripped:
        return _empty_local_user_data()

    try:
        return _normalize_local_user_data(json.loads(raw))
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        data, end_index = decoder.raw_decode(stripped)
        trailing = stripped[end_index:].strip()
        if trailing:
            return _normalize_local_user_data(data)
        raise


def _local_read_user_data(user_id: str) -> dict[str, Any]:
    with _local_user_lock(user_id):
        path = _local_user_path(user_id)
        if not os.path.exists(path):
            return _empty_local_user_data()
        return _read_json_with_trailing_recovery(path)


def _local_write_user_data(user_id: str, data: dict[str, Any]) -> None:
    with _local_user_lock(user_id):
        path = _local_user_path(user_id)
        directory = os.path.dirname(path)
        os.makedirs(directory, exist_ok=True)
        tmp_path = os.path.join(directory, f".{_safe_user_id(user_id)}.{uuid4().hex}.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(_normalize_local_user_data(data), f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)


def _dump_json(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump_json"):
        return json.loads(model.model_dump_json(exclude_none=True))
    data = _dump(model)
    for key, value in list(data.items()):
        if isinstance(value, datetime):
            data[key] = value.isoformat()
    return data


def _local_count_notes(user_id: str, video_id: str) -> int:
    data = _local_read_user_data(user_id)
    return sum(1 for note in data["notes"].values() if note.get("video_id") == video_id)


def _local_upsert_user_from_token(decoded_token: dict[str, Any]) -> UserProfile:
    uid = decoded_token["uid"]
    with _local_user_lock(uid):
        data = _local_read_user_data(uid)
        current = data.get("user", {})
        now = utc_now()
        user = UserProfile(
            id=uid,
            email=decoded_token.get("email") or current.get("email"),
            display_name=decoded_token.get("name") or current.get("display_name"),
            avatar_url=decoded_token.get("picture") or current.get("avatar_url"),
            created_at=current.get("created_at", now),
            updated_at=now,
            last_login_at=now,
        )
        data["user"] = _dump_json(user)
        _local_write_user_data(uid, data)
        return user


def _local_record_watch_history(user_id: str, payload: WatchHistoryUpdate) -> WatchHistoryRecord:
    with _local_user_lock(user_id):
        data = _local_read_user_data(user_id)
        now = utc_now()
        history_id = f"{user_id}_{payload.video_id}"
        current = data["history"].get(payload.video_id, {})

        record = WatchHistoryRecord(
            id=history_id,
            user_id=user_id,
            video_id=payload.video_id,
            last_position_ms=payload.last_position_ms or current.get("last_position_ms", 0),
            watched_seconds=max(payload.watched_seconds, current.get("watched_seconds", 0)),
            completed=payload.completed or current.get("completed", False),
            youtube_url=payload.youtube_url or current.get("youtube_url"),
            title=payload.title or current.get("title"),
            channel_name=payload.channel_name or current.get("channel_name"),
            thumbnail_url=payload.thumbnail_url or current.get("thumbnail_url"),
            duration_seconds=payload.duration_seconds or current.get("duration_seconds"),
            notes_count=_local_count_notes(user_id, payload.video_id),
            created_at=current.get("created_at", now),
            updated_at=now,
            last_watched_at=now,
        )
        data["history"][payload.video_id] = _dump_json(record)
        _local_write_user_data(user_id, data)
        return record


def _local_list_watch_history(user_id: str, limit: int = 30) -> list[WatchHistoryRecord]:
    with _local_user_lock(user_id):
        data = _local_read_user_data(user_id)
        records = []
        for item in data["history"].values():
            item["notes_count"] = _local_count_notes(user_id, item["video_id"])
            records.append(WatchHistoryRecord(**item))
        return sorted(records, key=lambda item: item.last_watched_at, reverse=True)[:limit]


def _local_create_note(user_id: str, payload: NoteCreate) -> NoteRecord:
    with _local_user_lock(user_id):
        data = _local_read_user_data(user_id)
        note_id = uuid4().hex
        now = utc_now()
        note = NoteRecord(id=note_id, user_id=user_id, created_at=now, updated_at=now, **_dump(payload))
        data["notes"][note_id] = _dump_json(note)
        _local_write_user_data(user_id, data)
        return note


def _local_list_notes(user_id: str, video_id: str) -> list[NoteRecord]:
    with _local_user_lock(user_id):
        data = _local_read_user_data(user_id)
        notes = [
            NoteRecord(**note)
            for note in data["notes"].values()
            if note.get("video_id") == video_id
        ]
        return sorted(notes, key=lambda item: item.timestamp_ms)


def upsert_user_from_token(decoded_token: dict[str, Any]) -> UserProfile:
    if _use_local_user_store():
        return _local_upsert_user_from_token(decoded_token)

    uid = decoded_token["uid"]
    now = utc_now()
    user_ref = get_firestore_client().collection("users").document(uid)
    current = _doc_to_dict(user_ref.get())

    user = UserProfile(
        id=uid,
        email=decoded_token.get("email") or (current or {}).get("email"),
        display_name=decoded_token.get("name") or (current or {}).get("display_name"),
        avatar_url=decoded_token.get("picture") or (current or {}).get("avatar_url"),
        created_at=(current or {}).get("created_at", now),
        updated_at=now,
        last_login_at=now,
    )
    user_ref.set(_dump(user), merge=True)
    return user


def upsert_video(payload: VideoUpsert) -> VideoRecord:
    now = utc_now()
    video_ref = get_firestore_client().collection("videos").document(payload.youtube_video_id)
    current = _doc_to_dict(video_ref.get())

    video = VideoRecord(
        id=payload.youtube_video_id,
        youtube_video_id=payload.youtube_video_id,
        youtube_url=payload.youtube_url or (current or {}).get("youtube_url"),
        title=payload.title or (current or {}).get("title"),
        channel_name=payload.channel_name or (current or {}).get("channel_name"),
        thumbnail_url=payload.thumbnail_url or (current or {}).get("thumbnail_url"),
        duration_seconds=payload.duration_seconds or (current or {}).get("duration_seconds"),
        source_language=payload.source_language or (current or {}).get("source_language"),
        created_at=(current or {}).get("created_at", now),
        updated_at=now,
    )
    video_ref.set(_dump(video), merge=True)
    return video


def record_watch_history(user_id: str, payload: WatchHistoryUpdate) -> WatchHistoryRecord:
    if _use_local_user_store():
        return _local_record_watch_history(user_id, payload)

    now = utc_now()
    if any(
        [
            payload.youtube_url,
            payload.title,
            payload.channel_name,
            payload.thumbnail_url,
            payload.duration_seconds is not None,
        ]
    ):
        upsert_video(
            VideoUpsert(
                youtube_video_id=payload.video_id,
                youtube_url=payload.youtube_url,
                title=payload.title,
                channel_name=payload.channel_name,
                thumbnail_url=payload.thumbnail_url,
                duration_seconds=payload.duration_seconds,
            )
        )

    history_id = f"{user_id}_{payload.video_id}"
    history_ref = get_firestore_client().collection("watch_history").document(history_id)
    current = _doc_to_dict(history_ref.get())
    video = _doc_to_dict(get_firestore_client().collection("videos").document(payload.video_id).get()) or {}

    history = WatchHistoryRecord(
        id=history_id,
        user_id=user_id,
        video_id=payload.video_id,
        last_position_ms=payload.last_position_ms or (current or {}).get("last_position_ms", 0),
        watched_seconds=max(payload.watched_seconds, (current or {}).get("watched_seconds", 0)),
        completed=payload.completed or (current or {}).get("completed", False),
        youtube_url=payload.youtube_url or (current or {}).get("youtube_url") or video.get("youtube_url"),
        title=payload.title or (current or {}).get("title") or video.get("title"),
        channel_name=payload.channel_name or (current or {}).get("channel_name") or video.get("channel_name"),
        thumbnail_url=payload.thumbnail_url or (current or {}).get("thumbnail_url") or video.get("thumbnail_url"),
        duration_seconds=payload.duration_seconds or (current or {}).get("duration_seconds") or video.get("duration_seconds"),
        notes_count=_count_notes(user_id, payload.video_id),
        created_at=(current or {}).get("created_at", now),
        updated_at=now,
        last_watched_at=now,
    )
    history_ref.set(_dump(history), merge=True)
    return history


def _count_notes(user_id: str, video_id: str) -> int:
    query = (
        get_firestore_client()
        .collection("notes")
        .where("user_id", "==", user_id)
        .where("video_id", "==", video_id)
    )
    return sum(1 for _ in _query_stream(query))


def list_watch_history(user_id: str, limit: int = 30) -> list[WatchHistoryRecord]:
    if _use_local_user_store():
        return _local_list_watch_history(user_id, limit=limit)

    query = (
        get_firestore_client()
        .collection("watch_history")
        .where("user_id", "==", user_id)
        .limit(limit)
    )
    records: list[WatchHistoryRecord] = []
    videos = get_firestore_client().collection("videos")

    for doc in _query_stream(query):
        data = doc.to_dict() or {}
        data.setdefault("id", doc.id)

        video_id = data.get("video_id")
        video = _doc_to_dict(videos.document(video_id).get()) if video_id else None
        if video:
            data.setdefault("youtube_url", video.get("youtube_url"))
            data.setdefault("title", video.get("title"))
            data.setdefault("channel_name", video.get("channel_name"))
            data.setdefault("thumbnail_url", video.get("thumbnail_url"))
            data.setdefault("duration_seconds", video.get("duration_seconds"))

        if video_id:
            data["notes_count"] = _count_notes(user_id, video_id)

        records.append(WatchHistoryRecord(**data))

    return sorted(records, key=lambda item: item.last_watched_at, reverse=True)[:limit]


def _normalize_transcript_segment(data: Any) -> dict[str, Any] | None:
    if isinstance(data, BaseModel):
        data = _dump(data)
    if not isinstance(data, dict):
        return None

    text = str(data.get("text") or "").strip()
    if not text:
        return None

    return {
        "start": float(data.get("start") or 0),
        "duration": float(data.get("duration") or 0),
        "text": text,
        "source": data.get("source") or "youtube_captions",
        "translated_text": data.get("translated_text"),
    }


def _normalize_transcript_segments(segments: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for segment in segments:
        normalized_segment = _normalize_transcript_segment(segment)
        if normalized_segment:
            normalized.append(normalized_segment)
    return normalized


def get_video_transcript(video_id: str) -> VideoTranscriptCache | None:
    cached = get_cached_video(video_id)
    if not cached:
        return None

    segments = _normalize_transcript_segments(cached.get("segments") or [])
    if not segments:
        return None

    return VideoTranscriptCache(
        video_id=video_id,
        source_lang=cached.get("source_lang") or cached.get("language_code") or "en",
        segments=[TranscriptSegmentRecord(**segment) for segment in segments],
    )


def save_video_transcript(payload: VideoTranscriptCache) -> VideoTranscriptCache:
    current = get_cached_video(payload.video_id) or {}
    incoming = _normalize_transcript_segments([_dump(segment) for segment in payload.segments])
    existing = _normalize_transcript_segments(current.get("segments") or [])

    merged: list[dict[str, Any]] = []
    for index, segment in enumerate(incoming):
        existing_segment = existing[index] if index < len(existing) else None
        if existing_segment and not segment.get("translated_text"):
            segment["translated_text"] = existing_segment.get("translated_text")
        merged.append(segment)

    cache_video(
        payload.video_id,
        {
            **current,
            "video_id": payload.video_id,
            "source_lang": payload.source_lang,
            "segments": merged,
        },
    )

    return VideoTranscriptCache(
        video_id=payload.video_id,
        source_lang=payload.source_lang,
        segments=[TranscriptSegmentRecord(**segment) for segment in merged],
    )


def create_note(user_id: str, payload: NoteCreate) -> NoteRecord:
    if _use_local_user_store():
        return _local_create_note(user_id, payload)

    note_id = uuid4().hex
    now = utc_now()
    note = NoteRecord(id=note_id, user_id=user_id, created_at=now, updated_at=now, **_dump(payload))
    get_firestore_client().collection("notes").document(note_id).set(_dump(note))
    return note


def list_notes(user_id: str, video_id: str) -> list[NoteRecord]:
    if _use_local_user_store():
        return _local_list_notes(user_id, video_id)

    query = (
        get_firestore_client()
        .collection("notes")
        .where("user_id", "==", user_id)
        .where("video_id", "==", video_id)
    )
    notes = _stream_to_models(NoteRecord, _query_stream(query))
    return sorted(notes, key=lambda item: item.timestamp_ms)


def update_note(user_id: str, note_id: str, payload: NoteUpdate) -> NoteRecord:
    note_ref = get_firestore_client().collection("notes").document(note_id)
    current = _doc_to_dict(note_ref.get())
    if not current or current.get("user_id") != user_id:
        raise KeyError("Note not found.")

    updates = _dump(payload)
    updates["updated_at"] = utc_now()
    note_ref.set(updates, merge=True)
    updated = _doc_to_dict(note_ref.get())
    return NoteRecord(**updated)


def delete_note(user_id: str, note_id: str) -> None:
    note_ref = get_firestore_client().collection("notes").document(note_id)
    current = _doc_to_dict(note_ref.get())
    if not current or current.get("user_id") != user_id:
        raise KeyError("Note not found.")
    note_ref.delete()


def save_summary(user_id: str, payload: SummaryCreate) -> SummaryRecord:
    summary_id = uuid4().hex
    now = utc_now()
    summary = SummaryRecord(
        id=summary_id,
        created_by=user_id,
        search_text=payload.summary_text.casefold(),
        created_at=now,
        updated_at=now,
        **_dump(payload),
    )
    get_firestore_client().collection("summaries").document(summary_id).set(_dump(summary))
    return summary


def get_latest_summary(video_id: str, language_code: str = "mn") -> SummaryRecord | None:
    query = (
        get_firestore_client()
        .collection("summaries")
        .where("video_id", "==", video_id)
        .where("language_code", "==", language_code)
        .order_by("created_at", direction="DESCENDING")
        .limit(1)
    )
    for doc in query.stream():
        data = doc.to_dict() or {}
        data.setdefault("id", doc.id)
        return SummaryRecord(**data)
    return None


def search_summaries(
    user_id: str,
    query_text: str,
    limit: int = 20,
) -> list[SummarySearchResult]:
    normalized = query_text.casefold().strip()
    if not normalized:
        return []

    watched_video_ids = {
        item.video_id for item in list_watch_history(user_id, limit=200)
    }
    if not watched_video_ids:
        return []

    results: list[SummarySearchResult] = []
    for doc in get_firestore_client().collection("summaries").limit(500).stream():
        data = doc.to_dict() or {}
        if data.get("video_id") not in watched_video_ids:
            continue

        haystack = data.get("search_text") or data.get("summary_text", "").casefold()
        score = haystack.count(normalized)
        if score:
            results.append(
                SummarySearchResult(
                    id=doc.id,
                    video_id=data["video_id"],
                    summary_text=data["summary_text"],
                    language_code=data.get("language_code", "mn"),
                    score=score,
                )
            )

    return sorted(results, key=lambda item: item.score, reverse=True)[:limit]


def create_processing_job(job: ProcessingJob) -> ProcessingJob:
    job_id = uuid4().hex
    job.id = job_id
    get_firestore_client().collection("processing_jobs").document(job_id).set(_dump(job))
    return job


def save_video_asset(payload: VideoAssetCreate) -> VideoAssetRecord:
    asset_id = uuid4().hex
    now = utc_now()
    asset = VideoAssetRecord(id=asset_id, created_at=now, updated_at=now, **_dump(payload))
    get_firestore_client().collection("video_assets").document(asset_id).set(_dump(asset))
    return asset


def list_video_assets(video_id: str) -> list[VideoAssetRecord]:
    query = (
        get_firestore_client()
        .collection("video_assets")
        .where("video_id", "==", video_id)
        .order_by("created_at", direction="DESCENDING")
    )
    return _stream_to_models(VideoAssetRecord, query.stream())


def create_voice_profile(payload: VoiceProfileCreate) -> VoiceProfileRecord:
    voice_id = uuid4().hex
    now = utc_now()
    voice = VoiceProfileRecord(id=voice_id, created_at=now, updated_at=now, **_dump(payload))
    get_firestore_client().collection("voice_profiles").document(voice_id).set(_dump(voice))
    return voice


def list_voice_profiles(active_only: bool = True) -> list[VoiceProfileRecord]:
    query = get_firestore_client().collection("voice_profiles")
    if active_only:
        query = query.where("is_active", "==", True)
    query = query.order_by("created_at")
    return _stream_to_models(VoiceProfileRecord, query.stream())


def get_processing_job(job_id: str) -> ProcessingJob | None:
    data = _doc_to_dict(get_firestore_client().collection("processing_jobs").document(job_id).get())
    return ProcessingJob(**data) if data else None


def create_chat_session(user_id: str, payload: ChatSessionCreate) -> ChatSessionRecord:
    session_id = uuid4().hex
    now = utc_now()
    session = ChatSessionRecord(
        id=session_id,
        user_id=user_id,
        created_at=now,
        updated_at=now,
        **_dump(payload),
    )
    get_firestore_client().collection("chat_sessions").document(session_id).set(_dump(session))
    return session


def get_chat_session_for_user(user_id: str, session_id: str) -> ChatSessionRecord | None:
    session_ref = get_firestore_client().collection("chat_sessions").document(session_id)
    data = _doc_to_dict(session_ref.get())
    if not data or data.get("user_id") != user_id:
        return None
    return ChatSessionRecord(**data)


def append_chat_message(
    user_id: str,
    session_id: str,
    payload: ChatMessageCreate,
) -> ChatMessageRecord:
    if not get_chat_session_for_user(user_id, session_id):
        raise KeyError("Chat session not found.")

    message_id = uuid4().hex
    message = ChatMessageRecord(
        id=message_id,
        session_id=session_id,
        created_at=utc_now(),
        **_dump(payload),
    )
    (
        get_firestore_client()
        .collection("chat_sessions")
        .document(session_id)
        .collection("messages")
        .document(message_id)
        .set(_dump(message))
    )
    return message


def list_chat_messages(
    user_id: str,
    session_id: str,
    limit: int = 50,
) -> list[ChatMessageRecord]:
    if not get_chat_session_for_user(user_id, session_id):
        raise KeyError("Chat session not found.")

    query = (
        get_firestore_client()
        .collection("chat_sessions")
        .document(session_id)
        .collection("messages")
        .order_by("created_at")
        .limit(limit)
    )
    return _stream_to_models(ChatMessageRecord, query.stream())


# ---------------------------------------------------------------------------
# Processed-video cache (dub pipeline)
#
# The dub pipeline (routers/pipeline.py) caches its processed
# {video_id, segments} payload here. Uses PostgreSQL when DATABASE_URL is set,
# otherwise falls back to JSON files under CACHE_DIR.
# ---------------------------------------------------------------------------

from app.config import DATABASE_URL, CACHE_DIR, get_settings


def get_cached_video(youtube_id: str) -> dict | None:
    if DATABASE_URL:
        return _pg_get(youtube_id)
    return _file_get(youtube_id)


def cache_video(youtube_id: str, data: dict) -> None:
    if DATABASE_URL:
        _pg_set(youtube_id, data)
    else:
        _file_set(youtube_id, data)


# --- PostgreSQL ---

def _pg_get(youtube_id: str) -> dict | None:
    try:
        import psycopg2
        with psycopg2.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT segments FROM videos WHERE youtube_id = %s",
                    (youtube_id,),
                )
                row = cur.fetchone()
                if row:
                    return row[0] if isinstance(row[0], dict) else json.loads(row[0])
    except Exception:
        return None


def _pg_set(youtube_id: str, data: dict) -> None:
    try:
        import psycopg2
        import psycopg2.extras
        with psycopg2.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO videos (youtube_id, segments)
                    VALUES (%s, %s)
                    ON CONFLICT (youtube_id) DO UPDATE SET segments = EXCLUDED.segments
                    """,
                    (youtube_id, json.dumps(data)),
                )
    except Exception:
        pass


# --- File fallback ---

def _file_get(youtube_id: str) -> dict | None:
    path = os.path.join(CACHE_DIR, f"{youtube_id}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return None


def _file_set(youtube_id: str, data: dict) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{youtube_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AssetType(str, Enum):
    SUBTITLE_VTT = "subtitle_vtt"
    TRANSCRIPT_JSON = "transcript_json"
    TRANSLATED_AUDIO = "translated_audio"


class AssetStatus(str, Enum):
    QUEUED = "queued"
    READY = "ready"
    FAILED = "failed"


class ChatRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class UserProfile(BaseModel):
    id: str
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    is_guest: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    last_login_at: datetime = Field(default_factory=utc_now)


class VideoUpsert(BaseModel):
    youtube_video_id: str = Field(min_length=6, max_length=32)
    youtube_url: str | None = None
    title: str | None = None
    channel_name: str | None = None
    thumbnail_url: str | None = None
    duration_seconds: int | None = Field(default=None, ge=0)
    source_language: str | None = Field(default=None, max_length=12)


class VideoRecord(VideoUpsert):
    id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class TranscriptSegmentRecord(BaseModel):
    start: float = 0.0
    duration: float = 0.0
    text: str = Field(min_length=1)
    translated_text: str | None = None


class VideoTranscriptCache(BaseModel):
    video_id: str = Field(min_length=6, max_length=32)
    source_lang: str = Field(default="en", min_length=2, max_length=12)
    translation_version: str | None = None
    translation_mode: str | None = None
    segments: list[TranscriptSegmentRecord]


class WatchHistoryUpdate(BaseModel):
    video_id: str
    last_position_ms: int = Field(default=0, ge=0)
    watched_seconds: int = Field(default=0, ge=0)
    completed: bool = False
    youtube_url: str | None = None
    title: str | None = Field(default=None, max_length=300)
    channel_name: str | None = Field(default=None, max_length=200)
    thumbnail_url: str | None = None
    duration_seconds: int | None = Field(default=None, ge=0)


class WatchHistoryRecord(WatchHistoryUpdate):
    id: str
    user_id: str
    notes_count: int = Field(default=0, ge=0)
    last_watched_at: datetime = Field(default_factory=utc_now)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class NoteCreate(BaseModel):
    video_id: str
    timestamp_ms: int = Field(ge=0)
    content: str = Field(min_length=1, max_length=4000)


class NoteUpdate(BaseModel):
    timestamp_ms: int | None = Field(default=None, ge=0)
    content: str | None = Field(default=None, min_length=1, max_length=4000)


class NoteRecord(NoteCreate):
    id: str
    user_id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class SummaryCreate(BaseModel):
    video_id: str
    language_code: str = Field(default="mn", min_length=2, max_length=12)
    summary_text: str = Field(min_length=1)
    model_name: str | None = None


class SummaryRecord(SummaryCreate):
    id: str
    created_by: str | None = None
    search_text: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class SummarySearchResult(BaseModel):
    id: str
    video_id: str
    summary_text: str
    language_code: str
    score: int


class VoiceProfileCreate(BaseModel):
    name: str
    provider: str
    voice_key: str
    language_code: str = Field(default="mn", min_length=2, max_length=12)
    gender: str | None = None
    is_active: bool = True


class VoiceProfileRecord(VoiceProfileCreate):
    id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class VideoAssetCreate(BaseModel):
    video_id: str
    asset_type: AssetType
    language_code: str = Field(default="mn", min_length=2, max_length=12)
    storage_path: str
    public_url: str | None = None
    voice_profile_id: str | None = None
    duration_seconds: int | None = Field(default=None, ge=0)
    status: AssetStatus = AssetStatus.READY


class VideoAssetRecord(VideoAssetCreate):
    id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ProcessVideoRequest(BaseModel):
    video: VideoUpsert
    target_language: str = Field(default="mn", min_length=2, max_length=12)
    voice_profile_id: str | None = None


class ChatSessionCreate(BaseModel):
    video_id: str
    summary_id: str | None = None
    title: str | None = None


class ChatSessionRecord(ChatSessionCreate):
    id: str
    user_id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ChatMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    role: ChatRole = ChatRole.USER


class ChatMessageRecord(ChatMessageCreate):
    id: str
    session_id: str
    created_at: datetime = Field(default_factory=utc_now)

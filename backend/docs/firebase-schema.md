# SightAhead Firebase Backend Schema

This project uses Firebase Auth for Google login, Firestore for app data, and
Firebase Storage or another object store for generated files.

## Request Flow

```text
Next.js client
  -> Firebase Auth Google login
  -> sends Firebase ID token to FastAPI
  -> FastAPI verifies token with firebase-admin
  -> FastAPI reads/writes Firestore
```

Audio, VTT subtitles, and transcript JSON should not be stored inside
Firestore. Store those files in Storage and save only metadata/path/url in
Firestore.

## Collections

### users/{firebase_uid}

```json
{
  "id": "firebase_uid",
  "email": "user@example.com",
  "display_name": "User name",
  "avatar_url": "https://...",
  "created_at": "timestamp",
  "updated_at": "timestamp",
  "last_login_at": "timestamp"
}
```

### videos/{youtube_video_id}

Use the YouTube video id as the Firestore document id. This avoids duplicate
records when different users open the same YouTube video.

```json
{
  "id": "dQw4w9WgXcQ",
  "youtube_video_id": "dQw4w9WgXcQ",
  "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "title": "Original title from YouTube",
  "channel_name": "Channel",
  "thumbnail_url": "https://...",
  "duration_seconds": 123,
  "source_language": "en",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### watch_history/{firebase_uid}_{youtube_video_id}

One document per user/video pair.

```json
{
  "id": "uid_videoid",
  "user_id": "firebase_uid",
  "video_id": "dQw4w9WgXcQ",
  "last_position_ms": 42000,
  "watched_seconds": 80,
  "completed": false,
  "last_watched_at": "timestamp",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### notes/{note_id}

Notes are top-level documents so a user can query all notes later.

```json
{
  "id": "note_id",
  "user_id": "firebase_uid",
  "video_id": "dQw4w9WgXcQ",
  "timestamp_ms": 42000,
  "content": "Important note at this exact video time.",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### summaries/{summary_id}

Summaries are stored separately from videos because the same video can have
multiple summaries by language, model, or version.

```json
{
  "id": "summary_id",
  "video_id": "dQw4w9WgXcQ",
  "language_code": "mn",
  "summary_text": "Mongolian summary...",
  "search_text": "lowercase normalized summary...",
  "model_name": "gemini-...",
  "created_by": "firebase_uid",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

The MVP uses simple substring search over `summary_text` and filters results to
videos already present in the current user's watch history. For production-scale
semantic search, add Algolia/Meilisearch or store embeddings in a vector search
service.

### video_assets/{asset_id}

```json
{
  "id": "asset_id",
  "video_id": "dQw4w9WgXcQ",
  "asset_type": "subtitle_vtt",
  "language_code": "mn",
  "storage_path": "videos/dQw4w9WgXcQ/mn/subtitle.vtt",
  "public_url": "https://...",
  "voice_profile_id": "voice_id",
  "duration_seconds": 123,
  "status": "ready",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

Recommended storage paths:

```text
videos/{youtube_video_id}/{language_code}/subtitle.vtt
videos/{youtube_video_id}/{language_code}/transcript.json
videos/{youtube_video_id}/{language_code}/voices/{voice_profile_id}.mp3
```

### voice_profiles/{voice_id}

```json
{
  "id": "voice_id",
  "name": "Mongolian Female 1",
  "provider": "azure",
  "voice_key": "mn-MN-...",
  "language_code": "mn",
  "gender": "female",
  "is_active": true,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### processing_jobs/{job_id}

```json
{
  "id": "job_id",
  "user_id": "firebase_uid",
  "video_id": "dQw4w9WgXcQ",
  "status": "queued",
  "step": "caption",
  "progress": 30,
  "error_message": null,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### chat_sessions/{session_id}

```json
{
  "id": "session_id",
  "user_id": "firebase_uid",
  "video_id": "dQw4w9WgXcQ",
  "summary_id": "summary_id",
  "title": "Optional chat title",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### chat_sessions/{session_id}/messages/{message_id}

```json
{
  "id": "message_id",
  "session_id": "session_id",
  "role": "user",
  "content": "Ask something about the summary...",
  "created_at": "timestamp"
}
```

## Firestore Indexes

Create composite indexes when Firestore asks for them in the console. The first
ones this API will likely need are:

```text
watch_history: user_id ASC, last_watched_at DESC
notes: user_id ASC, video_id ASC, timestamp_ms ASC
summaries: video_id ASC, language_code ASC, created_at DESC
chat_sessions/{session_id}/messages: created_at ASC
```

## FastAPI Endpoints In This Draft

```text
GET    /health
GET    /auth/me
POST   /auth/sync
POST   /videos
POST   /videos/process
GET    /videos/jobs/{job_id}
POST   /videos/history
GET    /videos/history
POST   /videos/{video_id}/notes
GET    /videos/{video_id}/notes
POST   /videos/{video_id}/assets
GET    /videos/{video_id}/assets
PATCH  /videos/notes/{note_id}
DELETE /videos/notes/{note_id}
POST   /summaries
GET    /summaries/search?q=...
GET    /summaries/{video_id}/latest
POST   /summaries/chat/sessions
POST   /summaries/chat/sessions/{session_id}/messages
GET    /summaries/chat/sessions/{session_id}/messages
POST   /voices
GET    /voices
```

All app endpoints except `/health` expect:

```text
Authorization: Bearer <Firebase ID token>
```

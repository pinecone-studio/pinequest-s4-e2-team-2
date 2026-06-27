# Sightahead — Backend

## Төслийн тухай

**Sightahead** нь YouTube видеог монгол хэлээр subtitle болон дубтайгаар үзэх боломж олгодог веб апп.

Хэрэглэгч YouTube URL оруулахад:
1. Browser-ээс YouTube caption татна (Railway IP block тойрох)
2. Монгол хэл рүү орчуулна
3. Azure TTS-ээр монгол дуб гаргана
4. Subtitle + дуб хоёуланг хэрэглэгчид саадгүй харуулна

---

## Архитектур

```
Frontend (Next.js)  →  Vercel
Backend (FastAPI)   →  Railway (512MB limit)
Database            →  Firebase Auth + Firestore + Storage
```

Frontend болон Backend нь REST API-аар харилцана.

---

## Backend Stack

| Зорилго | Технологи | Тэмдэглэл |
|---------|-----------|-----------|
| Framework | FastAPI (Python) | |
| Caption (PATH A) | youtube_transcript_api | Browser-ээс дамжуулна |
| Орчуулга | OpenAI (gpt-4o-mini) | TRANSLATION_PROVIDER=openai |
| Орчуулга fallback | Gemini API | TRANSLATION_PROVIDER=gemini |
| TTS | Azure Cognitive Services | mn-MN-YesuiNeural / BataaNeural |
| Database | Firebase Auth + Firestore + Storage | |
| Deploy | Railway | |

> **Устгагдсан:** yt-dlp, faster-whisper (PATH B), Coqui TTS, pyannote, ElevenLabs, PostgreSQL — Railway 512MB-д багтахгүй тул хасагдсан.

---

## Folder Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI entry point, router бүртгэл
│   ├── config.py            # env vars, API keys
│   ├── routers/
│   │   ├── pipeline.py      # POST /process, POST /summary — үндсэн pipeline
│   │   ├── video.py         # POST /videos/process — job queue (хэрэгжээгүй)
│   │   ├── summary.py       # GET /summaries
│   │   ├── auth.py          # POST /auth — нэвтрэлт
│   │   ├── tts.py           # POST /tts — TTS endpoint
│   │   └── voice.py         # дуу хоолой тохиргоо
│   ├── services/
│   │   ├── caption_fetcher.py   # YouTube caption татах (PATH A)
│   │   ├── translator.py        # OpenAI / Gemini орчуулга
│   │   ├── tts_service.py       # Azure TTS дуб
│   │   ├── cache_service.py     # Firestore + local file cache
│   │   ├── summary_service.py   # OpenAI / Gemini summary
│   │   ├── firebase_service.py  # Firebase Storage upload
│   │   └── auth_service.py      # Firebase Auth verify
│   ├── models/
│   │   ├── segment.py       # Segment dataclass
│   │   └── job.py           # Job state
│   └── utils/
│       ├── audio.py         # Firebase Storage upload, duration
│       └── lang.py          # language code normalization
├── requirements.txt
├── Dockerfile
├── AGENTS.md
└── CLAUDE.md
```

---

## Pipeline

```
POST /process { video_id, segments?, source_lang? }
        ↓
Cache шалгах (Firestore / local JSON)
        ↓ cache miss
Caption:
  segments ирвэл (frontend-ээс) → шууд ашиглах  ← YouTube IP block тойрох
  segments ирэхгүй бол → caption_fetcher.py (Railway-д IP block эрсдэлтэй)
        ↓
Segment[ ] { start, duration, text, source }
        ↓
OpenAI (gpt-4o-mini) → translated_text нэмнэ
        ↓
Azure TTS (mn-MN-YesuiNeural) → .mp3 → Firebase Storage upload
        ↓
segments буцаах → frontend subtitle + audio тоглуулна
```

---

## Segment Dataclass

```python
class Segment(BaseModel):
    start: float
    duration: float
    text: str
    source: Literal["youtube_captions", "whisper"]
    translated_text: str | None = None
    audio_path: str | None = None
    audio_ms: int | None = None
```

---

## API Endpoints

```
POST /process
  body: { video_id: string, segments?: CaptionSegment[], source_lang?: string }
  return: { segments: Segment[] }

POST /summary
  body: { video_id: string }
  return: { summary: string }

POST /tts
  body: { text: string, voice?: string }
  return: { audio_url: string, duration_ms: int }

POST /auth/register
POST /auth/login
POST /auth/logout
```

---

## Env Variables

```
APP_NAME=SightAhead API
ENVIRONMENT=local

# CORS
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# OpenAI (орчуулга — үндсэн)
OPENAI_API_KEY=
OPENAI_TRANSLATION_MODEL=gpt-4o-mini
TRANSLATION_PROVIDER=openai

# Azure TTS
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=southeastasia
TTS_PROVIDER=azure

# Firebase
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_CREDENTIALS_PATH=firebase-credentials.json

# Gemini (орчуулга fallback)
GEMINI_API_KEY=

# Локал тест
ENABLE_LOCAL_PROCESSING=true
```

---

## Чухал зарчим

- Cache эхлээд шалгах — боловсруулалт давтахгүй
- YouTube IP block → frontend (browser) caption татаж backend-д дамжуулна
- Railway 512MB — heavy ML (Whisper, pyannote) нэмэхгүй
- Firebase credentials → repo-д commit хийхгүй

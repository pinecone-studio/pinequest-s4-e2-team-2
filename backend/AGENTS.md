# Sightahead — Backend

## Төслийн тухай

**Sightahead** нь YouTube видеог монгол хэлээр subtitle болон дубтайгаар үзэх боломж олгодог веб апп.

Хэрэглэгч YouTube URL оруулахад:
1. Caption/audio татаж авна
2. Монгол хэл рүү орчуулна
3. Монгол дуб гаргана
4. Subtitle + дуб хоёуланг хэрэглэгчид саадгүй харуулна

---

## Архитектур

```
Frontend (Next.js)  →  Vercel
Backend (FastAPI)   →  Railway
Database            →  Firebase Auth + Firestore + Storage
```

Frontend болон Backend нь REST API-аар харилцана.

---

## Backend Stack

| Зорилго | Технологи |
|---------|-----------|
| Framework | FastAPI (Python) |
| STT (PATH A) | youtube_transcript_api |
| STT (PATH B fallback) | yt-dlp + faster-whisper |
| Орчуулга | Gemini API |
| TTS | Coqui TTS |
| Speaker detection | pyannote/speaker-diarization |
| Database | Firebase Auth + Firestore + Storage |
| Deploy | Railway |

---

## Folder Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI entry point, router бүртгэл
│   ├── config.py            # env vars, API keys
│   ├── routers/
│   │   ├── video.py         # POST /process — үндсэн pipeline
│   │   ├── summary.py       # POST /summary — видео тайлбар
│   │   └── auth.py          # POST /auth — нэвтрэлт
│   ├── services/
│   │   ├── caption_fetcher.py   # YouTube caption татах (PATH A)
│   │   ├── whisper_service.py   # yt-dlp + Whisper fallback (PATH B)
│   │   ├── translator.py        # Gemini API орчуулга
│   │   ├── tts_service.py       # Coqui TTS + pyannote дуб
│   │   ├── cache_service.py     # Firestore repository/cache
│   │   └── summary_service.py   # Gemini API summary
│   ├── models/
│   │   ├── segment.py       # Segment dataclass
│   │   ├── job.py           # Job state
│   │   └── schema.prisma    # Legacy note; runtime uses Firestore docs
│   └── utils/
│       ├── audio.py         # pad / stretch / merge
│       └── lang.py          # language code normalization
├── requirements.txt
├── Dockerfile
├── AGENTS.md
└── CLAUDE.md
```

---

## Pipeline

```
POST /process { video_id }
        ↓
Cache шалгах (Firestore)
        ↓ cache miss
Caption cascade
  PATH A: youtube_transcript_api → caption татна (хурдан)
  PATH B: yt-dlp + faster-whisper → fallback
        ↓
Segment[ ] { start, duration, text, source }
        ↓
Gemini API → translated_text нэмнэ
        ↓
pyannote → эрэгтэй/эмэгтэй тодорхойлно
Coqui TTS → тохирох хоолойгоор дуб гаргана
        ↓
audio.py → pad / stretch / merge
        ↓
.vtt subtitle + .mp3 дуб → cache хадгална → client
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

Энэ dataclass нь pipeline-ийн бүх алхамд нийтлэг хэрэглэгдэх суурь бүтэц.

---

## Database Schema

```
User
  id, email, name, password_hash, created_at

Video                          ← cache үүрэг
  id, youtube_id (unique), title, duration_sec,
  subtitle_path, dub_path, summary, processed_at

Note
  id, user_id (FK), video_id (FK),
  content, timestamp_sec, created_at

WatchHistory
  id, user_id (FK), video_id (FK),
  watched_at, progress_sec
```

---

## API Endpoints

```
POST /process
  body: { video_id: string }
  return: { subtitle_url, dub_url, segments: Segment[] }

POST /summary
  body: { video_id: string }
  return: { summary: string }

POST /auth/register
POST /auth/login
POST /auth/logout
```

---

## Env Variables

```
GEMINI_API_KEY=
DATABASE_URL=
ELEVENLABS_API_KEY=      # demo TTS
HF_TOKEN=                # pyannote (HuggingFace)
```

---

## Хүндрэлүүд

- `yt-dlp` Vercel дээр ажиллахгүй → Railway дээр backend тусдаа
- YouTube ToS: caption байвал audio татахгүй (PATH A эхлээд)
- Монгол TTS: Coqui монгол хэл бага — ElevenLabs demo-д ашиглах
- Урт видео: chunking хэрэгтэй (60+ мин)
- pyannote: HuggingFace token шаардлагатай

---

## Ажиллах дараалал

1. `backend/app/main.py` — FastAPI app үүсгэх
2. `backend/app/config.py` — env vars
3. `backend/app/models/segment.py` — Segment dataclass
4. `backend/app/services/caption_fetcher.py` — PATH A
5. `backend/app/services/whisper_service.py` — PATH B
6. `backend/app/services/translator.py` — Gemini API
7. `backend/app/services/tts_service.py` — Coqui + pyannote
8. `backend/app/services/cache_service.py` — Firestore
9. `backend/app/routers/video.py` — pipeline нэгтгэх
10. `backend/app/routers/summary.py`
11. `Dockerfile` — Railway deploy

---

## Чухал зарчим

- Cache эхлээд шалгах — боловсруулалт давтахгүй
- PATH A → PATH B: caption байвал audio татахгүй
- Segment dataclass нь pipeline-ийн бүх алхамд нийтлэг
- Эрэгтэй/эмэгтэй хоолой тусад нь — pyannote дарааллан TTS
- Voice cloning (v2) — одоо хэрэгжүүлэхгүй, architecture-д зай үлдэх

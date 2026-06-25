# HELEX — Хэлэх

> Монгол "хэлэх" үгнээс гаралтай — дуугаар, хэлээрээ subtitle + дуб хоёуланг илэрхийлнэ.

**SightAhead** багийн төсөл.

---

## Юу хийдэг вэ?

HELEX нь YouTube видеог **монгол subtitle болон дубтайгаар** үзэх боломж олгодог веб апп.

YouTube URL оруулахад:
1. Видеоны caption/audio автоматаар татагдана
2. Монгол хэл рүү орчуулагдана
3. Монгол дуб үүснэ
4. Subtitle + дуб хоёулаа нэгэн зэрэг тоглогдоно

---

## Технологи

| Хэсэг | Технологи |
|-------|-----------|
| Frontend | Next.js → Vercel |
| Backend | FastAPI (Python) → Railway |
| Database | PostgreSQL |
| Орчуулга | Gemini API |
| TTS | Azure / Chimege |
| STT | youtube-transcript-api / faster-whisper |

---

## Архитектур

```
Хэрэглэгч
    ↓
Frontend (Next.js)
    ↓  REST API
Backend (FastAPI)
    ↓
PostgreSQL (cache)
```

---

## Pipeline

```
YouTube URL
    ↓
Caption татах
  → PATH A: youtube-transcript-api (хурдан)
  → PATH B: yt-dlp + Whisper (fallback)
    ↓
Gemini API → Монгол орчуулга
    ↓
Azure/Chimege TTS → Монгол дуб
    ↓
.vtt subtitle + .mp3 дуб → cache → хэрэглэгч
```

---

## Эхлүүлэх

### Шаардлага

- Node.js 24+
- Python 3.11+
- PostgreSQL

### Frontend

```bash
cd web
npm install
npm run dev
```

### Backend

```bash
cd server
pip install -r requirements.txt
cp .env.example .env   # API key-үүдийг бөглөнө
uvicorn app.main:app --reload
```

### Env variables

```
GEMINI_API_KEY=
DATABASE_URL=
AZURE_TTS_KEY=
HF_TOKEN=
```

---

## Folder Structure

```
sightahead/
├── web/        # Next.js frontend
├── server/     # FastAPI backend
└── README.md
```

---

## Баг — SightAhead

| Нэр | Үүрэг |
|-----|-------|
| Battsengel | Backend |
| Zolbayar | Backend |
| Munkhbat | Frontend |
| Anudari | Frontend · UI/UX |
| Erkhem-erdene | Frontend |

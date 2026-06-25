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
| Database | Firebase Auth + Firestore |
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
Firebase / Firestore (cache + auth)
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

### Frontend

```bash
cd web
npm install
npm run dev
```

`http://localhost:3000` дээр нээгдэнэ.

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # API key-үүдийг бөглөнө
uvicorn app.main:app --reload
```

`http://localhost:8000` дээр ажиллана. API docs: `http://localhost:8000/docs`

### Шаардлагатай env variables

`backend/.env` файлд дараах key-үүдийг бөглөнө:

```
GEMINI_API_KEY=          # Google AI Studio
AZURE_SPEECH_KEY=        # Azure Cognitive Services
AZURE_SPEECH_REGION=     # жишээ: southeastasia
FIREBASE_PROJECT_ID=     # Firebase Console
FIREBASE_CREDENTIALS_PATH=   # service account JSON зам (локал)
# эсвэл
FIREBASE_CREDENTIALS_JSON=   # service account JSON агуулга (Railway)
```

---

## Folder Structure

```
sightahead/
├── web/        # Next.js frontend
├── backend/    # FastAPI backend
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

# Helex — CLAUDE.md

## Төслийн зорилго

**Helex** нь YouTube видеог монгол хэрэглэгчид **монгол subtitle болон монгол дубтайгаар** саадгүй үзүүлдэг веб апп.

Хэрэглэгч YouTube URL оруулахад:
- Монгол **subtitle** дэлгэцэнд харагдана
- Монгол **дуу** тоглогдоно
- Хоёулаа видеотой **нэгэн зэрэг синхроноор** ажиллана

Энэ бол аппын **цорын ганц, өөрчлөгдөшгүй зорилго.** Бусад бүх зүйл — stack, API, library — туршилтаар шийдэгдэнэ.

---

## Нэмэлт feature (хөгжүүлж байгаа)

**ASL дохионы хэл** — дүлий хэрэглэгчдэд зориулсан.
Subtitle-тэй нэгэн зэрэг дэлгэцийн **баруун доод буланд** ASL avatar харагдана.

---

## Системийн бүтэц

```
Browser (хэрэглэгч)
        ↓
Frontend — Next.js → Vercel
        ↓  REST API
Backend — FastAPI → Railway
        ↓
Гадаад үйлчилгээнүүд (орчуулга, TTS, auth, cache)
```

---

## Одоогийн stack

**Frontend:**
- Next.js (App Router), Tailwind, Firebase Auth
- Бүх backend дуудалт → `web/src/lib/backend-api.ts`-ээр дамжина

**Backend:**
- FastAPI (Python), Railway
- Орчуулга: OpenAI `gpt-4o-mini` (үндсэн), Gemini (fallback)
- TTS дуб: Azure Cognitive Services (`mn-MN-YesuiNeural`, `BataaNeural`)
- Auth + Cache: Firebase Auth, Firestore, Storage

---

## Үндсэн урсгал (яг одоо хэрхэн ажилладаг)

```
1. Хэрэглэгч YouTube хайлт хийнэ (аппын дотоод хайлт)
        ↓
2. Видео сонгоход browser caption татна
   web/src/app/api/youtube/transcript/route.ts → YouTube-с caption авна
        ↓
3. Caption-г backend-д илгээнэ
   POST /process { segments, source_lang }
        ↓
4. Backend монгол орчуулга хийнэ (OpenAI batch)
        ↓
5. Backend Azure TTS-ээр монгол дуб гаргана
        ↓
6. Segment бүр буцаана → frontend subtitle + audio нэгэн зэрэг тоглуулна
```

**Яагаад caption browser-ээс татдаг вэ:**
Railway-н datacenter IP-г YouTube блок хийдэг. Browser-ээс татаж backend-д дамжуулснаар тойрч гардаг.

---

## Subtitle + Дуб синхрон тоглуулах

Segment бүр `start`, `duration`, `translated_text`, `audio_b64` (эсвэл `audio_path`) агуулна.

```
YouTube player-н одоогийн цаг
        ↓
Тухайн цагт тохирох segment олно
        ↓
translated_text → subtitle давхаргад харагдана
audio_b64/audio_path → audio тоглуулна
        ↓
Хоёулаа нэгэн зэрэг ажиллана
```

---

## Segment өгөгдлийн бүтэц

```python
# Backend
class Segment(BaseModel):
    start: float
    duration: float
    text: str
    source: str
    translated_text: str | None = None
    audio_path: str | None = None
    audio_ms: int | None = None
```

```typescript
// Frontend
type Segment = {
  start: number;
  duration: number;
  text: string;
  translated_text: string | null;
  audio_path: string | null;
  audio_b64: string | null;
  audio_ms: number | null;
};
```

---

## ENV variables

**Backend (`backend/.env`):**
```
OPENAI_API_KEY=
GEMINI_API_KEY=
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=southeastasia
FIREBASE_PROJECT_ID=
FIREBASE_CREDENTIALS_JSON=
RAPIDAPI_KEY=
CORS_ORIGINS=http://localhost:3000
```

**Frontend (`web/.env.local`):**
```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

---

## Локал ажиллуулах

```bash
# Backend
cd backend
cp .env.example .env
pip install -r requirements.txt
uvicorn app.main:app --reload
# → http://localhost:8000/docs

# Frontend
cd web
npm install
npm run dev
# → http://localhost:3000
```

---

## Commit дүрэм

- Бусад гишүүний өмнөөс commit, push хийхгүй
- `Co-Authored-By` мөр нэмэхгүй
- Commit бүр яг тэр ажлыг хийсэн хүний нэрээр байна

---

## Дэлгэрэнгүй заавар

- Backend: `backend/AGENTS.md`
- Frontend: `web/AGENTS.md`

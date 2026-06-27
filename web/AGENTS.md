# Sightahead — Frontend

## Төслийн тухай

**Sightahead** нь YouTube видеог монгол хэлээр subtitle болон дубтайгаар үзэх боломж олгодог веб апп.

Хэрэглэгч YouTube URL оруулахад:
1. Browser caption татна → backend-д илгээнэ
2. Backend монгол орчуулга + Azure TTS дуб гаргана
3. Frontend subtitle + audio тоглуулна

---

## Stack

| Зорилго | Технологи |
|---------|-----------|
| Framework | Next.js (App Router) |
| Auth | Firebase Auth (Google Sign-In + email/password) |
| HTTP | axios (`lib/axios.ts` — Firebase token автоматаар залгадаг) |
| Deploy | Vercel |

---

## Folder Structure

```
web/src/
├── app/
│   ├── layout.tsx                  # Root layout, providers
│   ├── page.tsx                    # Нүүр хуудас
│   ├── login/page.tsx              # Нэвтрэх
│   ├── register/page.tsx           # Бүртгүүлэх
│   ├── forgot-password/page.tsx    # Нууц үг сэргээх
│   ├── dashboard.css               # Dashboard хэв маяг
│   ├── globals.css
│   └── api/
│       └── youtube/search/route.ts # YouTube хайлт (Next.js API route)
├── _comps/
│   ├── dashboard/
│   │   ├── DashboardView.tsx       # Гол UI — видео үзэх хуудас
│   │   ├── VideoPane.tsx           # YouTube player + subtitle
│   │   ├── VideoFrame.tsx          # YouTube iframe wrapper
│   │   ├── NotesPane.tsx           # Тэмдэглэл хэсэг
│   │   ├── NoteEditor.tsx          # Тэмдэглэл бичих
│   │   ├── NoteList.tsx            # Тэмдэглэлийн жагсаалт
│   │   ├── ScholarOverlay.tsx      # AI туслах overlay
│   │   ├── ScholarMessage.tsx      # AI туслахын хариу
│   │   ├── HistoryRail.tsx         # Үзсэн түүх
│   │   ├── RecommendedVideos.tsx   # Санал болгох видео
│   │   ├── useProcessedVideo.ts    # ← backend /process дуудах hook
│   │   ├── useYouTubePlayer.ts     # YouTube player API hook
│   │   └── youtubeApi.ts           # YouTube caption татах (browser-ээс)
│   ├── youtube-search/
│   │   ├── SearchForm.tsx
│   │   ├── SearchResults.tsx
│   │   └── api.ts
│   ├── providers/
│   │   ├── AuthProvider.tsx        # Firebase auth state
│   │   └── ThemeProvider.tsx
│   ├── ui/                         # Button, Input гэх мэт shared components
│   ├── SignInModal.tsx
│   ├── Header.tsx
│   └── RequireAuth.tsx             # Auth guard
├── lib/
│   ├── backend-api.ts              # ← БҮХИЙ Л backend дуудалт эндээс
│   ├── axios.ts                    # Firebase token interceptor
│   ├── firebase.ts                 # Firebase init
│   ├── auth.ts                     # Auth helper functions
│   ├── google-auth.ts              # Google Sign-In
│   └── youtube-search.ts           # YouTube хайлтын helper
├── hooks/
│   └── use-mobile.ts
└── types/
    └── yt-search.d.ts
```

---

## Backend-тэй харилцах дүрэм

**Бүхий л backend дуудалт `lib/backend-api.ts`-ээр дамжина.** Шууд `fetch` эсвэл `axios` дуудахгүй.

```ts
import { processVideo, fetchWatchHistory, createVideoNote } from "@/lib/backend-api";
```

### Гол endpoint-ууд

| Endpoint | Function | Юу хийдэг |
|----------|----------|-----------|
| `POST /process` | `processVideo(videoId)` | Орчуулга + дуб → segments буцаана |
| `POST /auth/sync` | `syncFirebaseUser(idToken)` | Firebase нэвтрэлт backend-д бүртгэх |
| `GET /videos/history` | `fetchWatchHistory()` | Үзсэн түүх |
| `POST /videos/history` | `recordWatchHistory(payload)` | Үзсэн түүх хадгалах |
| `GET /videos/:id/notes` | `fetchVideoNotes(videoId)` | Тэмдэглэл татах |
| `POST /videos/:id/notes` | `createVideoNote(...)` | Тэмдэглэл хадгалах |

### `processVideo` буцаах өгөгдөл

```ts
type Segment = {
  start: number;          // секунд
  duration: number;       // секунд
  text: string;           // эх caption (англи)
  translated_text: string | null;  // монгол орчуулга
  audio_path: string | null;       // Firebase Storage .mp3 URL
  audio_ms: number | null;         // audio урт (ms)
};
```

---

## Subtitle + Audio тоглуулах (хийгдээгүй — яаралтай!)

`useProcessedVideo.ts` hook нь `segments`-г авдаг ч **UI-д харагдахгүй байна**.

```ts
// DashboardView.tsx-д нэмэх ёстой:
const { segments } = useProcessedVideo(videoId);

// YouTube player-н цагтай синк хийж subtitle харуулах:
const currentSegment = segments.find(
  s => currentTime >= s.start && currentTime < s.start + s.duration
);
```

Audio (`audio_path`) тоглуулах:
```ts
<audio src={currentSegment?.audio_path} autoPlay />
```

---

## Чухал дүрмүүд

### ❌ Хийж болохгүй
- `useTranscriptLogger` эсвэл ямар нэгэн **frontend-д OpenAI дуудалт** нэмэхгүй — backend pipeline бий
- `lib/backend-api.ts`-г тойрч шууд `fetch('/process', ...)` хийхгүй
- YouTube caption-г backend руу **илгээхгүйгээр** `/process` дуудахгүй (Railway IP block)
- Hardcoded subtitle, mock data ашиглахгүй

### ✅ Хийх ёстой
- Caption татахдаа `youtubeApi.ts`-н функц ашиглах
- Backend дуудалт бүрт `lib/backend-api.ts`-н функц ашиглах
- Firebase auth шаардлагатай хуудасд `RequireAuth` wrapper ашиглах

---

## Env Variables

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

> **Анхаарал:** `NEXT_PUBLIC_API_BASE_URL`-н сүүлд `/` бичихгүй — double slash үүснэ.

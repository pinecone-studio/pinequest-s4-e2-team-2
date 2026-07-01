# SightAhead — Mongolian dub architecture

YouTube бичлэгийг **монгол хоолойгоор** хувиргадаг (subtitle + voice-over). Энэ
баримт нь **дубын систем** хэрхэн ажилладгийг тайлбарлана (notes/search/auth/history
нь тусдаа, энд хамаарахгүй).

---

## Урсгал (өндөр түвшин)

```
Browser (DUB toggle асаах)
  │  useProcessedVideo → /api/youtube/transcript (RapidAPI) → caption segments
  │  useDubAudio → POST /jobs {video_id, segments, voice_ref}
  ▼
FastAPI orchestration (CPU, always-on)
  1. cache_key = hash(video_id + lang + voice_ref)
  2. cache hit? → дууссан job-ийг шууд буцаа (GPU дуудахгүй)        [дахин дубладаггүй]
  3. in-flight? → тэр job-ийг буцаа                                  [давхар ажил үгүй]
  4. OpenAI орчуулга (duration-aware, богино → segment-д багтана)
  5. segment-үүдийг 8-аар CHUNK болгож Modal F5 рүү .spawn (параллель)
  6. job {processing, calls[], segments[]} хадгалж job_id буцаа
  ▼ (background, Modal GPU, scale-to-zero)
Modal F5 (gpu/f5_modal.py) — use_ema=False, preset voice (male/female)
  └ chunk бүр → WAV bytes буцаана
  ▼
GET /jobs/{id} (browser polling)
  - дууссан chunk бүрийн audio-г R2-д хийж, segment.audio_url бөглөнө  [INCREMENTAL]
  - progress = бөглөгдсөн segment % ; бүх chunk дуусахад status=done
  ▼
Browser: audio_url-уудыг видеоны цагтай синк тоглуулна (богино бол 1.5× хүртэл
         хурдасгаж segment-д багтаана). Subtitle = job-ийн translated_text.
```

**Гол зарчмууд:** GPU хэзээ ч request дотор синхроноор ажиллахгүй; ижил (видео+хэл+хоолой)
дахин дубладаггүй (cache); chunk-аар incremental тул эхний хэсэг эрт тоглоно.

---

## File map (дубын хэсэг)

### GPU — `gpu/` (Modal-д ТУСДАА deploy)
| Файл | Үүрэг |
|------|-------|
| `f5_modal.py` | Modal F5 app. `use_ema=False`. `VOICES` preset (male=киночин, female=YouTuber). `synthesize_segments(segments, ref_audio_b64?, voice?)` → WAV |
| `README.md` | weights upload + `modal deploy` заавар |

### Backend — `backend/app/`
| Файл | Үүрэг |
|------|-------|
| `routers/jobs.py` | `POST /jobs`, `GET /jobs/{id}` (validation + rate-limit) |
| `services/dub_service.py` | Зохион байгуулагч: cache/dedup → transcript → translate → **chunk spawn** → **incremental poll** |
| `services/transcript_service.py` | RapidAPI транскрипт (IP-блокгүй) |
| `services/translator.py` | OpenAI орчуулга (duration-aware, ~11 тэмдэгт/сек cap) |
| `services/gpu_tts_client.py` | Modal руу `.spawn()` + `get_result()` (seam) |
| `services/storage_service.py` | **Cloudflare R2** (S3-нийцтэй) — audio хадгалах seam |
| `services/job_service.py` | Firestore: job + cache + dedup + cache_key |
| `models/dub_job.py` | DubJob / DubSegment (calls[] = chunk бүрийн call_id) |

### Frontend — `web/src/`
| Файл | Үүрэг |
|------|-------|
| `_comps/dashboard/useProcessedVideo.ts` | Transcript татах (англи caption) |
| `_comps/dashboard/useDubAudio.ts` | DUB: /jobs үүсгэх, poll, audio_url-ийг синк тоглуулах (1.5× fit) |
| `_comps/dashboard/useTranslatedSubtitles.ts` | DUB унтарсан үед subtitle орчуулга (/process translate-only) |
| `lib/dub-job.ts` | `createDubJob` + `pollDubJob` (F5 /jobs client) |
| `lib/process-stream.ts` | `fetchTranscript` + `streamProcess` (subtitle-only) |
| `lib/rapid-transcript.ts` | RapidAPI транскрипт (Vercel route-ийн ард) |

---

## Хоолой
- **Preset (male/female):** Modal Volume-д `ref_male.wav` / `ref_female.wav` + `VOICES`-д
  текст. Frontend-ийн er/em toggle → `voice_ref`.
- **Voice cloning (cloning):** `ref_audio_b64` дамжуулбал тэр хоолойг клон хийнэ
  (одоо UI-д холбоогүй; ирээдүйд оригинал илтгэгчийн хоолой).

---

## Setup (хэрэгтэй account / key)
| Зорилго | Account | Key |
|---------|---------|-----|
| Транскрипт | RapidAPI | `RAPIDAPI_KEY` / `NEXT_PUBLIC_RAPID_API_KEY` |
| Орчуулга | OpenAI | `OPENAI_API_KEY` |
| GPU TTS | Modal | `modal token` (+ weights Volume-д upload, `modal deploy gpu/f5_modal.py`) |
| Audio storage | Cloudflare R2 | `R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/PUBLIC_BASE_URL` |
| Job store + auth | Firebase | `FIREBASE_*` (Firestore) |

Backend: `cd backend; .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload`
Frontend: `cd web; npm run dev` (→ localhost:3000)
GPU: `modal deploy gpu/f5_modal.py`

---

## Мэдэгдэж буй tuning зүйлс (дараа)
- **Чанар:** богино caption хэсгүүдийг F5 training-ийнхээс муу уншдаг. Орчуулгыг
  товч байлгах + богино segment-үүдийг нэгтгэх нь тусална.
- **Маш урт видео:** олон chunk → олон cold start (зардал). Chunk хэмжээ / max
  segment хязгаарыг тааруулж болно (`_CHUNK_SIZE`, `MAX_DUB_SEGMENTS`).
- **Voice cloning UI:** оригинал илтгэгчийн хоолойг автоматаар (аудио олж авах
  + diarization) — том ажил.

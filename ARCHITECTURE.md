# SightAhead — Voice-over architecture (scale-to-zero)

YouTube бичлэгийг **монгол хоолойгоор** хувиргадаг систем. GPU-г scale-to-zero
болгож, хэрэглэгч ямар ч хүсэлтэд GPU-г синхроноор хүлээдэггүй болгосон.

## Гурван layer

```
┌─ Browser ──────────────────────────────────────────────────────────────┐
│  POST /jobs {video_id}          GET /jobs/{id}  (polling)                │
└───────────┬──────────────────────────────▲─────────────────────────────┘
            ▼                               │
┌─ Orchestration (FastAPI, Render, CPU, always-on, 512MB) ────────────────┐
│  routers/jobs.py        → validate, rate-limit                          │
│  services/dub_service   → cache/dedup → transcript → translate → spawn  │
│  services/transcript_service (RapidAPI)   services/translator (OpenAI)  │
│  services/job_service (Firestore)   services/storage_service (Firebase) │
│  services/gpu_tts_client → .spawn() ──────────────┐  poll ◄──────────┐  │
└───────────────────────────────────────────────────┼─────────────────┼──┘
                                                     ▼                 │
┌─ GPU (Modal, serverless, scale-to-zero) ───────────────────────────┐  │
│  gpu/f5_modal.py — F5-TTS inference (use_ema=False)                 │  │
│  weights+vocab in a Modal Volume; warm 60s then scales to zero      │──┘
└─────────────────────────────────────────────────────────────────────┘
            │ audio (b64)
            ▼
┌─ Storage / Cache ───────────────────────────────────────────────────────┐
│  Firebase Storage: dub/{cache_key}/seg_N.wav  (audio files)             │
│  Firestore dub_jobs: job state + result; cache_key = hash(video+lang+voice) │
└──────────────────────────────────────────────────────────────────────────┘
```

**Яагаад ингэв:** GPU нь хамгийн үнэтэй, удаан хэсэг. Үүнийг тусдаа serverless
давхарга болгосноор (1) web layer тэр даруй хариу өгнө, (2) idle үед GPU $0,
(3) нэг layer унахад бусад нь унахгүй (decoupling).

## Урсгал
1. `POST /jobs {video_id}` → `cache_key = hash(video_id+lang+voice)`
2. **Cache hit** → дууссан job-ийг шууд буцаа (GPU дуудахгүй)
3. **In-flight** → ижил job явж байвал түүнийг буцаа (dedup)
4. Transcript (RapidAPI) → guardrail шалгах → орчуулга (OpenAI) → Mongolian segments
5. `gpu_tts_client.spawn_synthesis(...)` → Modal background, `call_id` буцаана
6. Job-ийг Firestore-д `processing` төлөвөөр хадгалж, `job_id` шууд буцаана
7. `GET /jobs/{id}` polling → Modal дууссан бол audio-г Storage-д хийж, URL-ээ
   job-д бичээд `done`

## Setup — хэрэгтэй account / key

| Зорилго | Account | Key / тохиргоо |
|---------|---------|----------------|
| Транскрипт | **RapidAPI** (video-transcript-scraper) | `RAPIDAPI_KEY` |
| Орчуулга | **OpenAI** | `OPENAI_API_KEY` |
| GPU TTS | **Modal** | `modal token new` (эсвэл `MODAL_TOKEN_ID/SECRET`) |
| Auth + job store + audio | **Firebase** | `FIREBASE_*` (Firestore + Storage идэвхжүүл) |
| (fallback орчуулга) | Google **Gemini** | `GEMINI_API_KEY` |

### 1. Backend (orchestration)
```bash
cd backend
cp .env.example .env          # түлхүүрүүдээ бөглө
pip install -r requirements.txt
uvicorn app.main:app --reload # → http://127.0.0.1:8000  (/health, /docs)
```

### 2. GPU (Modal F5) — тусдаа deploy
`gpu/README.md`-г үз. Товчоор:
```bash
pip install -r gpu/requirements.txt
modal token new
modal volume put sightahead-f5-weights mn_model_last.pt /mn_model_last.pt
modal volume put sightahead-f5-weights mn_vocab.txt      /mn_vocab.txt
modal volume put sightahead-f5-weights ref_default.wav   /ref_default.wav
modal deploy gpu/f5_modal.py
```

### 3. Турших
```bash
curl -X POST http://127.0.0.1:8000/jobs -H "Content-Type: application/json" \
  -d '{"video_id":"BjGo3jcDj_A"}'
# → {"id":"...","status":"processing",...}
curl http://127.0.0.1:8000/jobs/<id>     # дуустал polling → segments[].audio_url
```

## Архитектурын зарчмууд (код дотор баримталсан)
1. **Decoupling** — layer бүр нэг ажил, API/spawn-аар л харилцана
2. **Sync vs async** — GPU хэзээ ч request дотор синхроноор ажиллахгүй
3. **Scale-to-zero** — Modal idle үед 0 (төлбөргүй)
4. **Caching** — ижил (video+lang+voice) дахин GPU-аар үүсгэхгүй (`job_service`)
5. **Dedup** — ижил job 2 удаа орвол нэг л боловсруулна (`find_inflight`)
6. **Guardrails** — урт видео/текстийг GPU-аас өмнө таслана (`MAX_DUB_SEGMENTS`)
7. **Seams** — `storage_service` (Firebase→R2), `job_service` (Firestore→Redis)
   дараа 1 файл сольж scale хийхэд бэлэн

## Лиценз / ёс зүй
- **F5-TTS = CC-BY-NC** (non-commercial). Commercial ашиглахаас өмнө хяна.
- **Voice cloning** — эх дуучны зөвшөөрөл / зөвшөөрөгдсөн хэрэглээнд л.

## Migration тэмдэглэл
- Шинэ **`/jobs`** = F5 async зам (үндсэн). Хуучин **`/process`** (Azure, SSE)
  одоохондоо хэвээр — frontend-ийг `/jobs` polling руу шилжүүлсний дараа устгана.
- Frontend: `lib/process-stream.ts` (SSE) → `POST /jobs` + `GET /jobs/{id}` polling.

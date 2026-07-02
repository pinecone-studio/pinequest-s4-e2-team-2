import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings, AUDIO_DIR
from app.routers import assistant, auth, summary, video, voice, pipeline, translate, jobs, payments
from app.routers.tts import router as tts_router


# Configure application logging so app loggers (e.g. the /process pipeline)
# actually surface. Set LOG_LEVEL=DEBUG to see per-segment transcript logs.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)

settings = get_settings()

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static dub audio served from the local audio directory.
#this needs to be deployed to database ffs, server dont have it, servers just wipe out
os.makedirs(AUDIO_DIR, exist_ok=True)
app.mount("/audio", StaticFiles(directory=AUDIO_DIR), name="audio")

# Firestore-backed auth + CRUD layer (schema branch)
app.include_router(auth.router)
app.include_router(video.router)
app.include_router(summary.router)
app.include_router(voice.router)

# Dub pipeline + translation engine
app.include_router(pipeline.router)
app.include_router(translate.router)

# Async F5 dub pipeline (jobs → Modal GPU)
app.include_router(jobs.router)
app.include_router(assistant.router)
app.include_router(payments.router)

# TTS synthesis endpoint
app.include_router(tts_router)


@app.get("/", tags=["system"])
def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "health": "/health",
        "docs": "/docs",
    }


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}

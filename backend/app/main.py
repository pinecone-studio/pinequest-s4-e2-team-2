import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings, AUDIO_DIR
from app.routers import auth, summary, video, voice, pipeline, translate
from app.routers.tts import router as tts_router


settings = get_settings()

app = FastAPI(title=settings.app_name)

# CORS must be active for the browser preflight (OPTIONS) to succeed — without
# it, OPTIONS falls through to the routes (GET/POST only) and returns 405, and
# no Access-Control-Allow-Origin header is ever sent.
#
# allow_origin_regex matches Vercel's per-deploy URLs (e.g.
# helex-<hash>-<team>.vercel.app), which a static allowlist can't keep up with.
# allow_credentials=True is required for the guest session_id cookie; note that
# this forbids the "*" origin, hence the explicit list + regex.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
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

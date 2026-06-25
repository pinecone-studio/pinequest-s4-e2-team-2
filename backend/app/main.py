import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings, AUDIO_DIR
from app.routers import auth, summary, video, voice, pipeline, translate


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

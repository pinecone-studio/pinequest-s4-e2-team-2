from dataclasses import dataclass
from functools import lru_cache
import os


try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def _csv(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str
    environment: str
    cors_origins: list[str]
    firebase_project_id: str | None
    firebase_credentials_json: str | None
    firebase_credentials_json_base64: str | None
    firebase_credentials_path: str | None
    firebase_storage_bucket: str | None
    gemini_api_key: str | None
    hf_token: str | None


@lru_cache
def get_settings() -> Settings:
    return Settings(
        app_name=os.getenv("APP_NAME", "SightAhead API"),
        environment=os.getenv("ENVIRONMENT", "local"),
        cors_origins=_csv(
            os.getenv("CORS_ORIGINS"),
            ["http://localhost:3000", "http://127.0.0.1:3000"],
        ),
        firebase_project_id=os.getenv("FIREBASE_PROJECT_ID"),
        firebase_credentials_json=os.getenv("FIREBASE_CREDENTIALS_JSON"),
        firebase_credentials_json_base64=os.getenv("FIREBASE_CREDENTIALS_JSON_BASE64"),
        firebase_credentials_path=os.getenv("FIREBASE_CREDENTIALS_PATH"),
        firebase_storage_bucket=os.getenv("FIREBASE_STORAGE_BUCKET"),
        gemini_api_key=os.getenv("GEMINI_API_KEY"),
        hf_token=os.getenv("HF_TOKEN"),
    )


# --- Processing pipeline (caption → translate → TTS dub) ---
# Module-level constants consumed by the dub pipeline services.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
DATABASE_URL = os.getenv("DATABASE_URL", "")
AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY", "")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION", "eastus")
HF_TOKEN = os.getenv("HF_TOKEN", "")
AUDIO_DIR = os.getenv("AUDIO_DIR", "audio")
CACHE_DIR = os.getenv("CACHE_DIR", "cache")

# --- Async F5 dub pipeline (jobs → Modal GPU) ---
# RapidAPI transcript (scraped on RapidAPI's infra, so no YouTube IP-block).
RAPID_API_URL = os.getenv("RAPID_API_URL", "")
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")
# Deployed Modal app/class that runs F5 (see gpu/f5_modal.py).
MODAL_F5_APP = os.getenv("MODAL_F5_APP", "sightahead-f5")
MODAL_F5_CLASS = os.getenv("MODAL_F5_CLASS", "F5")
# Cost guardrails — reject runaway inputs before spending GPU time.
MAX_DUB_SEGMENTS = int(os.getenv("MAX_DUB_SEGMENTS", "1500"))
MAX_TRANSCRIPT_CHARS = int(os.getenv("MAX_TRANSCRIPT_CHARS", "60000"))

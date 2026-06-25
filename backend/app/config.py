import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
DATABASE_URL = os.getenv("DATABASE_URL", "")

AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY", "")
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION", "eastus")

HF_TOKEN = os.getenv("HF_TOKEN", "")

AUDIO_DIR = os.getenv("AUDIO_DIR", "audio")
CACHE_DIR = os.getenv("CACHE_DIR", "cache")

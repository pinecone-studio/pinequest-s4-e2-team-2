import base64
import binascii
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import get_settings


BACKEND_DIR = Path(__file__).resolve().parents[2]


def _certificate_from_json(raw_value: str) -> Any:
    from firebase_admin import credentials

    raw_value = raw_value.strip()
    if not raw_value:
        raise ValueError("Firebase credentials JSON is empty.")

    try:
        return credentials.Certificate(json.loads(raw_value))
    except json.JSONDecodeError as exc:
        raise ValueError(
            "FIREBASE_CREDENTIALS_JSON must contain the full Firebase service account JSON. "
            "For base64-encoded JSON, use FIREBASE_CREDENTIALS_JSON_BASE64.",
        ) from exc


def _certificate_from_base64(raw_value: str) -> Any:
    try:
        decoded = base64.b64decode(raw_value.strip(), validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise ValueError("FIREBASE_CREDENTIALS_JSON_BASE64 is not valid base64 JSON.") from exc

    return _certificate_from_json(decoded)


def _resolve_credentials_path(raw_value: str) -> Path:
    path = Path(raw_value).expanduser()
    candidates = [path]

    if not path.is_absolute():
        candidates.append(BACKEND_DIR / path)

    for candidate in candidates:
        if candidate.exists():
            return candidate

    checked_paths = ", ".join(str(candidate) for candidate in candidates)
    raise FileNotFoundError(
        f"Firebase credentials file not found. Checked: {checked_paths}. "
        "Set FIREBASE_CREDENTIALS_JSON or FIREBASE_CREDENTIALS_JSON_BASE64 on Railway "
        "instead of using a local file path.",
    )


def _load_certificate() -> Any:
    settings = get_settings()

    try:
        from firebase_admin import credentials
    except ImportError as exc:
        raise RuntimeError(
            "firebase-admin is not installed. Run `pip install -r requirements.txt` "
            "inside the backend folder."
        ) from exc

    if settings.firebase_credentials_json:
        return _certificate_from_json(settings.firebase_credentials_json)

    if settings.firebase_credentials_json_base64:
        return _certificate_from_base64(settings.firebase_credentials_json_base64)

    if settings.firebase_credentials_path:
        path = _resolve_credentials_path(settings.firebase_credentials_path)
        return credentials.Certificate(str(path))

    google_credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if google_credentials_path:
        path = _resolve_credentials_path(google_credentials_path)
        return credentials.Certificate(str(path))

    raise RuntimeError(
        "Firebase Admin credentials are not configured. Set FIREBASE_CREDENTIALS_JSON, "
        "FIREBASE_CREDENTIALS_JSON_BASE64, or FIREBASE_CREDENTIALS_PATH."
    )



@lru_cache
def get_firebase_app() -> Any:
    settings = get_settings()

    try:
        import firebase_admin
    except ImportError as exc:
        raise RuntimeError(
            "firebase-admin is not installed. Run `pip install -r requirements.txt` "
            "inside the backend folder."
        ) from exc

    if firebase_admin._apps:
        return firebase_admin.get_app()

    options: dict[str, str] = {}
    if settings.firebase_project_id:
        options["projectId"] = settings.firebase_project_id
    if settings.firebase_storage_bucket:
        options["storageBucket"] = settings.firebase_storage_bucket

    return firebase_admin.initialize_app(_load_certificate(), options)


def get_firestore_client() -> Any:
    try:
        from firebase_admin import firestore
    except ImportError as exc:
        raise RuntimeError(
            "firebase-admin is not installed. Run `pip install -r requirements.txt` "
            "inside the backend folder."
        ) from exc

    get_firebase_app()
    return firestore.client()


def verify_id_token(id_token: str) -> dict[str, Any]:
    try:
        from firebase_admin import auth
    except ImportError as exc:
        raise RuntimeError(
            "firebase-admin is not installed. Run `pip install -r requirements.txt` "
            "inside the backend folder."
        ) from exc

    get_firebase_app()
    return auth.verify_id_token(id_token)

def get_storage_bucket() -> Any:
    try:
        from firebase_admin import storage
    except ImportError as exc:
        raise RuntimeError(
            "firebase-admin is not installed. Run `pip install -r requirements.txt` "
            "inside the backend folder."
        ) from exc

    get_firebase_app()
    return storage.bucket()
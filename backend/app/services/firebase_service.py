import json
from functools import lru_cache
from typing import Any

from app.config import get_settings


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
        raw_value = settings.firebase_credentials_json.strip()
        if raw_value.startswith("{"):
            return credentials.Certificate(json.loads(raw_value))
        return credentials.Certificate(raw_value)

    if settings.firebase_credentials_path:
        return credentials.Certificate(settings.firebase_credentials_path)

    return credentials.ApplicationDefault()


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

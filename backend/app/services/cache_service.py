import json
import os
from app.config import DATABASE_URL, CACHE_DIR


def get_cached_video(youtube_id: str) -> dict | None:
    if DATABASE_URL:
        return _pg_get(youtube_id)
    return _file_get(youtube_id)


def cache_video(youtube_id: str, data: dict) -> None:
    if DATABASE_URL:
        _pg_set(youtube_id, data)
    else:
        _file_set(youtube_id, data)


# --- PostgreSQL ---

def _pg_get(youtube_id: str) -> dict | None:
    try:
        import psycopg2
        with psycopg2.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT segments FROM videos WHERE youtube_id = %s",
                    (youtube_id,),
                )
                row = cur.fetchone()
                if row:
                    return row[0] if isinstance(row[0], dict) else json.loads(row[0])
    except Exception:
        return None


def _pg_set(youtube_id: str, data: dict) -> None:
    try:
        import psycopg2
        import psycopg2.extras
        with psycopg2.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO videos (youtube_id, segments)
                    VALUES (%s, %s)
                    ON CONFLICT (youtube_id) DO UPDATE SET segments = EXCLUDED.segments
                    """,
                    (youtube_id, json.dumps(data)),
                )
    except Exception:
        pass


# --- File fallback ---

def _file_get(youtube_id: str) -> dict | None:
    path = os.path.join(CACHE_DIR, f"{youtube_id}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return None


def _file_set(youtube_id: str, data: dict) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{youtube_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

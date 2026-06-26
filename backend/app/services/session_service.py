import uuid
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class GuestSession:
    session_id: str
    created_at: datetime


# In-memory only — fine for a single-process demo/guest flow. Sessions are
# lost on restart and not shared across worker processes; swap for
# Redis/Firestore if the deployment ever runs more than one process.
_sessions: dict[str, GuestSession] = {}


def create_guest_session() -> GuestSession:
    session = GuestSession(session_id=str(uuid.uuid4()), created_at=datetime.now(timezone.utc))
    _sessions[session.session_id] = session
    return session


def get_guest_session(session_id: str) -> GuestSession | None:
    return _sessions.get(session_id)

"""Seam to the serverless GPU (Modal F5 app in gpu/f5_modal.py).

Falls back to Azure TTS automatically when Modal is not installed.
Deploy the GPU app first (for production):  modal deploy gpu/f5_modal.py
"""

import base64
import logging
import os
import uuid

MODAL_APP = os.getenv("MODAL_F5_APP", "sightahead-f5")
MODAL_CLS = os.getenv("MODAL_F5_CLASS", "F5")

logger = logging.getLogger(__name__)

# In-process store for Azure TTS fallback results (keyed by fake call_id).
_azure_results: dict[str, list[dict]] = {}


def _modal_available() -> bool:
    try:
        import modal  # noqa: F401
        return True
    except ImportError:
        return False


def spawn_synthesis(
    segments: list[dict],
    ref_audio_b64: str | None = None,
    ref_text: str = "",
    voice: str | None = None,
) -> str:
    """Kick off synthesis for a chunk. Returns a call id to poll with get_result().

    segments: [{"index": int, "text": "<mongolian>"}]

    Modal available  → spawns F5 GPU job, returns Modal call id.
    Modal not installed → synthesises with Azure TTS synchronously, returns a
    local UUID whose result is immediately available via get_result().
    """
    if _modal_available():
        import modal
        f5 = modal.Cls.from_name(MODAL_APP, MODAL_CLS)
        call = f5().synthesize_segments.spawn(segments, ref_audio_b64, ref_text)
        return call.object_id

    logger.info("Modal not available — Azure TTS fallback for %d segments", len(segments))
    from app.services.tts_service import synthesize

    results: list[dict] = []
    for seg in segments:
        try:
            audio_bytes = synthesize(seg["text"], {"gender": "female"})
            results.append({
                "index": seg["index"],
                "audio_b64": base64.b64encode(audio_bytes).decode(),
                "audio_ms": len(audio_bytes) * 8 // 128,
            })
        except Exception as exc:  # noqa: BLE001
            logger.warning("Azure TTS fallback failed seg %s: %s", seg.get("index"), exc)

    call_id = f"azure-{uuid.uuid4()}"
    _azure_results[call_id] = results
    return call_id


def get_result(call_id: str) -> list[dict] | None:
    """Return the synthesis result if finished, else None (still running).

    Result: [{"index": int, "audio_b64": "<bytes>", "audio_ms": int}]
    """
    if call_id in _azure_results:
        return _azure_results.pop(call_id)

    if not _modal_available():
        logger.warning("get_result: unknown call_id %s and Modal not available", call_id)
        return []

    import modal
    fc = modal.FunctionCall.from_id(call_id)
    try:
        return fc.get(timeout=0)
    except TimeoutError:
        return None
    except Exception as exc:  # noqa: BLE001
        if "404" in str(exc):
            return None
        raise

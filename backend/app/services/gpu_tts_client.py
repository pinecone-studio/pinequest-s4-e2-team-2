"""Seam to the serverless GPU (Modal F5 app in gpu/f5_modal.py).

The backend never imports torch or runs the model — it just hands work to Modal
via the SDK and polls the result. `.spawn()` returns immediately with a call id;
the web request is never blocked on the GPU (async rule).

Deploy the GPU app first:  modal deploy gpu/f5_modal.py
"""

import os

MODAL_APP = os.getenv("MODAL_F5_APP", "sightahead-f5")
MODAL_CLS = os.getenv("MODAL_F5_CLASS", "F5")


def spawn_synthesis(
    segments: list[dict],
    ref_audio_b64: str | None = None,
    ref_text: str = "",
) -> str:
    """Kick off background GPU synthesis for a whole video. Returns a Modal call
    id to poll later with get_result().

    segments: [{"index": int, "text": "<mongolian>"}]
    """
    import modal

    f5 = modal.Cls.from_name(MODAL_APP, MODAL_CLS)
    call = f5().synthesize_segments.spawn(segments, ref_audio_b64, ref_text)
    return call.object_id


def get_result(call_id: str) -> list[dict] | None:
    """Return the GPU result if finished, else None (still running).

    Result: [{"index": int, "audio_b64": "<wav>", "audio_ms": int}]
    """
    import modal

    fc = modal.FunctionCall.from_id(call_id)
    try:
        return fc.get(timeout=0)  # timeout=0 → don't block; raises if not ready
    except TimeoutError:
        return None  # still running
    except Exception as exc:  # noqa: BLE001
        # Modal can surface a 404 while the result isn't ready yet — treat as pending.
        if "404" in str(exc):
            return None
        raise

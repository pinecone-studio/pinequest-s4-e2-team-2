"""Serverless GPU F5-TTS inference on Modal (scale-to-zero).

This is the ONLY GPU component. It is deployed to Modal SEPARATELY from the
Render backend (which stays 512MB / CPU-only):

    modal deploy gpu/f5_modal.py

The fine-tuned Mongolian weights + vocab live in a Modal Volume so the container
only loads them from fast local disk on cold start (no re-download). See README.md.

The backend (app/services/gpu_tts_client.py) calls `synthesize_segments` via the
Modal SDK with `.spawn()` so the web request never blocks on the GPU.

Why a class with @modal.enter(): the model loads ONCE per warm container and is
reused across calls — only cold starts pay the load cost. `scaledown_window`
keeps the GPU warm briefly after a request, then it scales to zero (no idle cost).
"""

import modal

app = modal.App("sightahead-f5")

# Paths inside the container — mounted from the Volume below.
MODEL_PATH = "/weights/mn_model_last.pt"
VOCAB_PATH = "/weights/mn_vocab.txt"
# Phase 1 = one fixed Mongolian voice for every video. Upload a clean ~10s clip
# as ref_default.wav. Phase 2 (voice cloning) passes a per-video ref instead.
DEFAULT_REF_AUDIO = "/weights/ref_default.wav"
# Exact transcript of ref_default.wav. Set this for Mongolian refs — Whisper
# mis-transcribes Mongolian (outputs garbage), which produces broken/short audio.
DEFAULT_REF_TEXT = "Хэрэв Умард Солонгост дайны аюул тулгарвал тэр гэрээ үйлчилнэ."

# GPU image: torch + f5-tts (pulls transformers/vocos) + soundfile; ffmpeg for I/O.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("torch", "soundfile", "f5-tts")
)

# Persistent volume holding weights/vocab/default-ref (uploaded once, see README).
weights = modal.Volume.from_name("sightahead-f5-weights", create_if_missing=True)


@app.cls(
    image=image,
    gpu="T4",  # ~$0.60/hr; F5 needs ~2-3GB VRAM. Bump to "L4"/"A10G" for speed.
    volumes={"/weights": weights},
    scaledown_window=60,  # stay warm 60s after the last call, then scale to zero
    timeout=600,
)
class F5:
    @modal.enter()
    def load(self):
        """Runs once when a container starts; model is reused for warm calls."""
        from f5_tts.api import F5TTS

        # ⚠️ use_ema=False is REQUIRED: the EMA weights are stuck near an early
        # training step (sound wrong); model_state_dict (step ~32700) is correct.
        self.model = F5TTS(
            model="F5TTS_v1_Base",
            ckpt_file=MODEL_PATH,
            vocab_file=VOCAB_PATH,
            use_ema=False,
        )

    @modal.method()
    def synthesize_segments(
        self,
        segments: list[dict],
        ref_audio_b64: str | None = None,
        ref_text: str = "",
    ) -> list[dict]:
        """Synthesize a whole video's segments in one GPU session.

        segments: [{"index": int, "text": "<mongolian>"}]
        ref_audio_b64: optional per-video reference clip (voice cloning). If None,
            the bundled DEFAULT_REF_AUDIO (fixed Mongolian voice) is used.
        Returns: [{"index": int, "audio_b64": "<wav>", "audio_ms": int}]
        """
        import base64
        import io

        import soundfile as sf

        # Resolve the reference voice once for the whole batch.
        if ref_audio_b64:
            ref_path = "/tmp/ref.wav"
            with open(ref_path, "wb") as f:
                f.write(base64.b64decode(ref_audio_b64))
            ref_text_used = ref_text or ""  # "" → Whisper auto-transcribe
        else:
            ref_path = DEFAULT_REF_AUDIO
            ref_text_used = DEFAULT_REF_TEXT

        results: list[dict] = []
        for seg in segments:
            text = (seg.get("text") or "").strip()
            if not text:
                results.append({"index": seg["index"], "audio_b64": "", "audio_ms": 0})
                continue

            wav, sr, _ = self.model.infer(
                ref_file=ref_path,
                ref_text=ref_text_used,
                gen_text=text,
            )
            buf = io.BytesIO()
            sf.write(buf, wav, sr, format="WAV")
            results.append(
                {
                    "index": seg["index"],
                    "audio_b64": base64.b64encode(buf.getvalue()).decode("ascii"),
                    "audio_ms": int(len(wav) / sr * 1000),
                }
            )
        return results


@app.local_entrypoint()
def smoke_test():
    """`modal run gpu/f5_modal.py` — quick check the model loads and speaks."""
    out = F5().synthesize_segments.remote(
        [{"index": 0, "text": "Энэ бол монгол хэл дээрх туршилт юм."}]
    )
    print("segments:", len(out), "audio_ms:", out[0]["audio_ms"] if out else None)

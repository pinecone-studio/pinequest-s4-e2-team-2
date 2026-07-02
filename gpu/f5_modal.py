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
# High-quality reference: uncompressed source, 24kHz mono, no background music.
# ref_male.wav is also the fallback for any voice without its own preset.
DEFAULT_REF_AUDIO = "/weights/ref_male.wav"
# Exact transcript of the reference clip (Whisper mis-reads Mongolian, so set it).
# Verified 2026-07-02: this clip + fix_duration gives clean, intelligible output
# (clone_test_v4_mn_fixdur.wav) — the production default until a per-video clone
# is worth revisiting (see useDubAudio.ts note on cross-lingual cloning).
_MALE_REF_TEXT = (
    "Сайн байцгаана уу, киночид оо. Өнөөдөр та бүхэнд мянга есөн зуун ерэн хоёр "
    "онд нээлтээ хийсэн гол дүрд нь Жеки Чан тоглосон супер поп киног ярьж "
    "өгөхөөр бэлдлээ."
)
DEFAULT_REF_TEXT = _MALE_REF_TEXT

# Preset voices selected by the frontend voice toggle (voice_ref). Female has no
# dedicated clip yet → falls back to DEFAULT (the male clip) until one is added.
VOICES = {
    "male": {"audio": "/weights/ref_male.wav", "text": _MALE_REF_TEXT},
}

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
    # Stay warm 5 min after the last call, then scale to zero. The cold start
    # reloads the ~5GB checkpoint (~30-60s) — the dominant "why is it slow to
    # start after I switch voice" cost. A 5-min window keeps the container warm
    # across voice switches / rebuilds during active use, while still costing
    # nothing once the user stops (worst case ~$0.05 of idle GPU per session).
    scaledown_window=300,
    timeout=600,
    # Cap concurrent GPU containers: chunked spawns queue here instead of
    # exhausting the account's GPU quota (ResourceExhaustedError). Still
    # incremental (chunks finish in waves) and fewer cold starts (reuse).
    max_containers=3,
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
        voice: str | None = None,
        ref_start: float | None = None,
        ref_duration: float | None = None,
    ) -> list[dict]:
        """Synthesize a whole video's segments in one GPU session.

        segments: [{"index": int, "text": "<mongolian>"}]
        ref_audio_b64: optional per-video reference clip (voice cloning).
        ref_start/ref_duration: when set, ref_audio_b64 is a RAW undecoded
        prefix (byte 0 through ref_start+ref_duration) — compressed audio can
        only be decoded from its container header at byte 0, so the caller
        can't pre-trim client-side. We ffmpeg-trim the exact window here.
        voice: preset voice key ("male"/"female") → bundled ref clip.
        Priority: ref_audio_b64 > voice preset > DEFAULT.
        Returns: [{"index": int, "audio_b64": "<wav>", "audio_ms": int}]
        """
        import base64
        import io
        import subprocess

        import soundfile as sf

        # Resolve the reference voice once for the whole batch.
        if ref_audio_b64:
            raw_bytes = base64.b64decode(ref_audio_b64)
            if ref_start is not None and ref_duration is not None:
                raw_path = "/tmp/ref_raw.bin"
                with open(raw_path, "wb") as f:
                    f.write(raw_bytes)
                ref_path = "/tmp/ref.wav"
                subprocess.run(
                    [
                        "ffmpeg", "-y", "-i", raw_path,
                        "-ss", str(ref_start), "-t", str(ref_duration),
                        "-ac", "1", "-ar", "24000",
                        ref_path,
                    ],
                    check=True,
                    capture_output=True,
                )
            else:
                ref_path = "/tmp/ref.wav"
                with open(ref_path, "wb") as f:
                    f.write(raw_bytes)
            ref_text_used = ref_text or ""  # "" → Whisper auto-transcribe
        elif voice and voice in VOICES:
            ref_path = VOICES[voice]["audio"]
            ref_text_used = VOICES[voice]["text"]
        else:
            ref_path = DEFAULT_REF_AUDIO
            ref_text_used = DEFAULT_REF_TEXT

        # F5's own duration heuristic (`ref_audio_len * gen_bytes / ref_bytes`,
        # UTF-8 BYTE length) only breaks when ref_text and gen_text are
        # different scripts (Latin ref + Cyrillic gen inflated duration ~2x —
        # see git history). ref_text is now ALWAYS the bundled Mongolian
        # preset and gen_text is always Mongolian too, so the byte ratio is
        # valid again and we let F5 pick its own natural pace.
        #
        # We tried forcing fix_duration = the ORIGINAL (source-language)
        # segment's caption duration for A/V sync, but that stretches speech
        # into an unnaturally slow drawl whenever natural Mongolian speech
        # (translate_timed already aims to fit the slot, but imperfectly) is
        # shorter than the source caption's timing — confirmed on the
        # dashboard 2026-07-02. The client already speeds up audio that runs
        # LONG for its slot (useDubAudio.ts, capped at 1.35x); that one-sided
        # safety net is enough — don't fight it by forcing elongation here.

        import re

        import numpy as np

        # Safety net: bracketed caption tags ("[Music]", "(laughs)") are
        # sound/emotion markers, not speech — the voice must never read them.
        # The translator strips these upstream, but cached translations (and
        # any other caller) may still carry them, so strip here too.
        bracket_tag = re.compile(r"[\[(][^\])]{0,40}[\])]")
        # Sentence boundary: period/!/?/… followed by whitespace.
        sentence_split = re.compile(r"(?<=[.!?…])\s+")
        # Breath pause inserted between sentences. A segment's text is a merged
        # sentence GROUP; reading it in one infer() call produced run-on speech
        # that "breathed" at random mid-sentence spots (Common Voice training
        # clips are single sentences, so the model never learned sentence-end
        # pauses). Synthesizing per sentence guarantees each one is read as a
        # complete calm unit, with the breath exactly at the full stop.
        _BREATH_SEC = 0.45

        results: list[dict] = []
        for seg in segments:
            text = (seg.get("text") or "").strip()
            text = " ".join(bracket_tag.sub(" ", text).split())
            if not text:
                results.append({"index": seg["index"], "audio_b64": "", "audio_ms": 0})
                continue

            sentences = [s.strip() for s in sentence_split.split(text) if s.strip()]
            pieces: list[np.ndarray] = []
            sr = 24000
            for i, sentence in enumerate(sentences):
                wav, sr, _ = self.model.infer(
                    ref_file=ref_path,
                    ref_text=ref_text_used,
                    gen_text=sentence,
                    nfe_step=48,        # more denoising steps → smoother, less robotic (default 32)
                    cfg_strength=1.5,   # lower → less over-emphasized/robotic monotone (default 2.0)
                    speed=1.08,         # mild pace boost, mirrors Azure's static +30% rate boost
                )
                if i > 0:
                    pieces.append(np.zeros(int(sr * _BREATH_SEC), dtype=np.asarray(wav).dtype))
                pieces.append(np.asarray(wav))
            full = pieces[0] if len(pieces) == 1 else np.concatenate(pieces)

            buf = io.BytesIO()
            sf.write(buf, full, sr, format="WAV")
            results.append(
                {
                    "index": seg["index"],
                    "audio_b64": base64.b64encode(buf.getvalue()).decode("ascii"),
                    "audio_ms": int(len(full) / sr * 1000),
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


@app.local_entrypoint()
def test_clone(
    ref_path: str,
    ref_text: str = "",
    gen_text: str = "Сайн байна уу, энэ бол миний хоолойгоор орчуулсан жишээ юм.",
    out: str = "clone_test.wav",
    ref_start: float = -1,
    ref_duration: float = -1,
):
    """Test voice cloning with a custom reference clip (e.g. a clip cut from a
    YouTube video). Writes the synthesized Mongolian audio to `out` locally.

    ref_text="" lets f5-tts auto-transcribe the reference via Whisper — fine
    when the reference clip itself is NOT Mongolian (Whisper only mis-reads
    Mongolian; other languages transcribe fine).

    Pass --ref-start/--ref-duration to test the ffmpeg-trim path (ref_path is
    then a RAW untrimmed prefix, e.g. what lib/audio-ref.ts downloads) instead
    of an already-trimmed clip.

        modal run gpu/f5_modal.py::test_clone --ref-path "C:/path/clip.mp3"
    """
    import base64

    with open(ref_path, "rb") as f:
        ref_audio_b64 = base64.b64encode(f.read()).decode("ascii")

    result = F5().synthesize_segments.remote(
        [{"index": 0, "text": gen_text}],
        ref_audio_b64=ref_audio_b64,
        ref_text=ref_text,
        ref_start=ref_start if ref_start >= 0 else None,
        ref_duration=ref_duration if ref_duration >= 0 else None,
    )
    seg = result[0]
    with open(out, "wb") as f:
        f.write(base64.b64decode(seg["audio_b64"]))
    print(f"Saved {out} ({seg['audio_ms']}ms)")

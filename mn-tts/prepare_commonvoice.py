"""Common Voice (Mongolian) -> F5-TTS dataset хөрвүүлэгч.

Mozilla Common Voice-ийн mn corpus-ийг F5-TTS finetune-д шаардлагатай
формат руу хөрвүүлнэ:

    <output>/
      wavs/<id>.wav        # 24kHz, mono, 16-bit
      metadata.csv         # "wavs/<id>.wav|<монгол текст>" мөр бүрээр

ffmpeg-ийг `imageio-ffmpeg` багцаас автоматаар олно (систем суулгах
шаардлагагүй).  Хугацааг Common Voice-ийн clip_durations.tsv-аас уншина
(ffprobe хэрэггүй).

    pip install imageio-ffmpeg

Ажиллуулах жишээ:
    python prepare_commonvoice.py \
        --cv-dir "C:/datasets/cv-corpus-26.0-2026-06-12/mn" \
        --out "C:/datasets/mn_f5" \
        --tsv validated.tsv --limit 2000
"""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import subprocess
import sys
from pathlib import Path

# Windows консол дээр Кирилл хэвлэхэд кодчиллын алдаа гарахаас сэргийлнэ.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    from tqdm import tqdm
except ImportError:
    def tqdm(x, **_):
        return x


CYRILLIC = re.compile(r"[Ѐ-ӿ]")
ALLOWED = re.compile(r"[^Ѐ-ӿ\s\.,!\?\-:;«»\"'…]")


def get_ffmpeg() -> str | None:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def is_good_text(text: str) -> bool:
    if len(text) < 2:
        return False
    total = len(re.sub(r"\s", "", text))
    if total == 0:
        return False
    cyr = len(CYRILLIC.findall(text))
    foreign = len(ALLOWED.findall(text))
    return cyr / total >= 0.6 and foreign / total <= 0.15


def load_durations(cv_dir: Path) -> dict[str, float]:
    """clip_durations.tsv -> {clip_name: seconds}.  Байхгүй бол хоосон."""
    path = cv_dir / "clip_durations.tsv"
    durations: dict[str, float] = {}
    if not path.exists():
        return durations
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            name = row.get("clip") or row.get("path") or ""
            dur_key = next((k for k in row if "duration" in k.lower()), None)
            if name and dur_key:
                try:
                    durations[name] = float(row[dur_key]) / 1000.0
                except ValueError:
                    pass
    return durations


def convert_to_wav(ffmpeg: str, src: Path, dst: Path, sr: int) -> bool:
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src),
        "-ac", "1", "-ar", str(sr), "-sample_fmt", "s16",
        str(dst),
    ]
    return subprocess.run(cmd).returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cv-dir", required=True, help="Common Voice mn фолдер (clips/ + *.tsv)")
    ap.add_argument("--out", required=True, help="Гаралтын F5 dataset фолдер")
    ap.add_argument("--tsv", default="validated.tsv")
    ap.add_argument("--sr", type=int, default=24000)
    ap.add_argument("--min-sec", type=float, default=1.0)
    ap.add_argument("--max-sec", type=float, default=15.0)
    ap.add_argument("--limit", type=int, default=0, help="Зөвхөн эхний N (0 = бүгд)")
    args = ap.parse_args()

    ffmpeg = get_ffmpeg()
    if not ffmpeg:
        print("ffmpeg олдсонгүй. `pip install imageio-ffmpeg` хийнэ үү.", file=sys.stderr)
        return 1

    cv_dir = Path(args.cv_dir)
    clips_dir = cv_dir / "clips"
    tsv_path = cv_dir / args.tsv
    out_dir = Path(args.out)
    wavs_dir = out_dir / "wavs"
    wavs_dir.mkdir(parents=True, exist_ok=True)

    if not tsv_path.exists():
        print(f"TSV олдсонгүй: {tsv_path}", file=sys.stderr)
        return 1

    durations = load_durations(cv_dir)
    print(f"clip_durations.tsv-аас {len(durations)} хугацаа уншлаа.")

    with open(tsv_path, encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))
    if args.limit:
        rows = rows[: args.limit]

    kept = skipped_text = skipped_dur = skipped_audio = 0
    metadata_lines: list[str] = []

    for row in tqdm(rows, desc="Хөрвүүлж байна"):
        text = normalize_text(row.get("sentence", ""))
        if not is_good_text(text):
            skipped_text += 1
            continue

        name = row.get("path", "")
        if durations:
            dur = durations.get(name)
            if dur is not None and not (args.min_sec <= dur <= args.max_sec):
                skipped_dur += 1
                continue

        src = clips_dir / name
        if not src.exists():
            skipped_audio += 1
            continue

        stem = Path(name).stem
        dst = wavs_dir / f"{stem}.wav"
        if not convert_to_wav(ffmpeg, src, dst, args.sr):
            skipped_audio += 1
            continue

        metadata_lines.append(f"wavs/{stem}.wav|{text}")
        kept += 1

    (out_dir / "metadata.csv").write_text("\n".join(metadata_lines) + "\n", encoding="utf-8")

    print("\n=== Дүн ===")
    print(f"Хадгалсан клип:    {kept}")
    print(f"Текстээр хассан:   {skipped_text}")
    print(f"Хугацаагаар хассан:{skipped_dur}")
    print(f"Аудиогаар хассан:  {skipped_audio}")
    print(f"Гаралт: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

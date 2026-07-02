// Server-side reference-audio extraction for F5 voice cloning.
//
// F5 needs a short (~8-12s) clip of the ORIGINAL speaker's voice + its exact
// transcript. We don't trim it here: compressed audio (m4a/webm) can only be
// decoded from its start (the container header lives at byte 0), so we
// download the RAW stream from byte 0 through the end of the desired window
// and let the GPU side (which already has ffmpeg installed) cut the exact
// [start, duration] slice with `ffmpeg -ss/-t` before handing it to F5.
//
// Uses the same InnerTube ANDROID player response as captions.ts — that
// client returns direct (uncipered) format URLs, and the request goes out
// from Vercel's IP (not Railway's blocked datacenter range).

import { fetchPlayerResponse, INNERTUBE_UA, type AdaptiveFormat } from "@/lib/captions";

const MAX_BYTES = 20 * 1024 * 1024; // hard cap: never download more than this
const DEFAULT_BITRATE = 128_000; // bits/sec fallback if the format omits it
const MARGIN = 1.25; // safety margin on the estimated byte offset (VBR slack)

function pickAudioFormat(formats: AdaptiveFormat[] | undefined): AdaptiveFormat | null {
  if (!formats?.length) return null;
  const audioOnly = formats.filter((f) => f.mimeType?.startsWith("audio/") && f.url);
  if (!audioOnly.length) return null;
  // Prefer itag 140 (AAC/m4a) — broadest ffmpeg/torchaudio decoder support.
  return (
    audioOnly.find((f) => f.itag === 140) ??
    audioOnly.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]
  );
}

function extFromMime(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "m4a";
  return "bin";
}

export type ReferenceClipSource = {
  audio_b64: string;
  ext: string;
};

// Downloads the raw audio bytes covering [0, start+duration] of a video's
// audio track. Throws if the video has no audio-only adaptive format.
export async function fetchReferenceClipSource(
  videoId: string,
  start: number,
  duration: number,
): Promise<ReferenceClipSource> {
  const player = await fetchPlayerResponse(videoId);
  const format = pickAudioFormat(player.streamingData?.adaptiveFormats);
  if (!format?.url) {
    throw new Error("No audio-only stream available for this video.");
  }

  const bitrateBitsPerSec = format.bitrate || DEFAULT_BITRATE;
  const targetEndSec = Math.max(1, start + duration);
  const estimatedBytes = Math.ceil((targetEndSec * bitrateBitsPerSec * MARGIN) / 8);
  const endByte = Math.min(estimatedBytes, MAX_BYTES);

  const res = await fetch(format.url, {
    // The googlevideo CDN URL was issued to the ANDROID client — fetching it
    // with a different (or absent) User-Agent gets a 403.
    headers: { Range: `bytes=0-${endByte}`, "User-Agent": INNERTUBE_UA },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Audio stream fetch failed: HTTP ${res.status}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return { audio_b64: buf.toString("base64"), ext: extFromMime(format.mimeType) };
}

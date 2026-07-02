import type { NextRequest } from "next/server";
import { fetchReferenceClipSource } from "@/lib/audio-ref";

// Fetches the raw audio bytes needed to build an F5 voice-cloning reference
// clip for a video. Returns the RAW (untrimmed) prefix — the GPU side trims
// it to the exact [start, duration] window with ffmpeg. See lib/audio-ref.ts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LOG = "[audio-ref-route]";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    videoId?: string;
    start?: number;
    duration?: number;
  } | null;

  const videoId = body?.videoId?.trim();
  const start = body?.start;
  const duration = body?.duration;

  if (!videoId || typeof start !== "number" || typeof duration !== "number" || duration <= 0) {
    return Response.json(
      { error: "videoId, start, and duration are required." },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  try {
    const clip = await fetchReferenceClipSource(videoId, start, duration);
    console.log(`${LOG} → ok`, {
      videoId,
      start,
      duration,
      bytes: Math.round((clip.audio_b64.length * 3) / 4),
      tookMs: Date.now() - startedAt,
    });
    return Response.json(clip);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reference audio fetch failed.";
    console.warn(`${LOG} ✗`, { videoId, message, tookMs: Date.now() - startedAt });
    return Response.json({ error: message }, { status: 502 });
  }
}

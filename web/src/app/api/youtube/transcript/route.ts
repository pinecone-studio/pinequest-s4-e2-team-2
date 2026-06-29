import type { NextRequest } from "next/server";
import { fetchRapidTranscript } from "@/lib/rapid-transcript";

// Fetches the transcript SERVER-SIDE via the RapidAPI scraper (see
// lib/rapid-transcript.ts). RapidAPI scrapes from its own infra, so the old
// YouTube datacenter IP-block doesn't apply, and keeping it server-side hides
// the API key and avoids CORS. The client renders the returned segments.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG = "[transcript-route]";

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId")?.trim();
  console.log(`${LOG} ← request received`, {
    videoId,
    url: request.nextUrl.pathname + request.nextUrl.search,
  });

  if (!videoId) {
    console.warn(`${LOG} ✗ rejected: missing videoId`);
    return Response.json({ error: "videoId is required." }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const { segments, source_lang } = await fetchRapidTranscript(videoId);

    if (!segments.length) {
      console.warn(`${LOG} ✗ empty transcript`, { videoId });
      return Response.json(
        {
          error: "No transcript available for this video.",
          videoId,
          detail: "EmptyTranscript",
        },
        { status: 502 },
      );
    }

    console.log(`${LOG} → responding 200`, {
      videoId,
      source_lang,
      segmentCount: segments.length,
      tookMs: Date.now() - startedAt,
      firstSegment: segments[0] ?? null,
      lastSegment: segments.at(-1) ?? null,
    });

    return Response.json({ video_id: videoId, source_lang, segments });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcript unavailable.";
    console.error(`${LOG} ✗ RapidAPI fetch failed`, {
      videoId,
      tookMs: Date.now() - startedAt,
      message,
    });
    return Response.json(
      { error: message, videoId, detail: "RapidApiError" },
      { status: 502 },
    );
  }
}

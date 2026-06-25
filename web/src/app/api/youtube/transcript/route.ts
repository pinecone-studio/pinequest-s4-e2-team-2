import type { NextRequest } from "next/server";
import { getYouTubeTranscript } from "@/lib/youtube-transcript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId")?.trim() ?? "";
  const language = request.nextUrl.searchParams.get("lang")?.trim() || "en";

  if (!VIDEO_ID_RE.test(videoId)) {
    return Response.json({ error: "Valid videoId is required." }, { status: 400 });
  }

  try {
    const transcript = await getYouTubeTranscript(videoId, language);

    console.log("[youtube transcript]", {
      videoId: transcript.videoId,
      language: transcript.language,
      source: transcript.source,
      segmentCount: transcript.segments.length,
    });
    console.log(JSON.stringify(transcript.segments, null, 2));

    return Response.json(transcript);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcript fetch failed.";
    console.error("[youtube transcript error]", { videoId, message });

    return Response.json({ error: message }, { status: 502 });
  }
}

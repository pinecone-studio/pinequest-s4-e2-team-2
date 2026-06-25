import type { TranscriptSegment, YouTubeTranscript } from "@/lib/youtube-transcript";
import { translateTranscriptToMongolian } from "@/lib/transcript-translation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readSource(value: unknown): TranscriptSegment["source"] {
  return value === "youtube-auto-caption" ? "youtube-auto-caption" : "youtube-caption";
}

function readSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) throw new Error("segments array is required.");

  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`segments[${index}] must be an object.`);

    const text = readString(item.text).trim();
    if (!text) throw new Error(`segments[${index}].text is required.`);

    const start = readNumber(item.start);
    const duration = readNumber(item.duration);

    return {
      start,
      duration,
      end: readNumber(item.end, start + duration),
      text,
      language: readString(item.language, "unknown"),
      source: readSource(item.source),
    };
  });
}

function readTranscript(body: unknown): YouTubeTranscript {
  if (!isRecord(body)) throw new Error("Request body must be a JSON object.");

  const videoId = readString(body.videoId).trim();
  if (!VIDEO_ID_RE.test(videoId)) throw new Error("Valid videoId is required.");

  const segments = readSegments(body.segments);

  return {
    videoId,
    language: readString(body.language, segments[0]?.language ?? "unknown"),
    source: readSource(body.source),
    segments,
  };
}

export async function POST(request: Request) {
  try {
    const transcript = readTranscript(await request.json());
    const translation = await translateTranscriptToMongolian(transcript);

    console.log("[youtube transcript translation]", {
      videoId: translation.videoId,
      sourceLanguage: translation.sourceLanguage,
      targetLanguage: translation.targetLanguage,
      model: translation.model,
      cached: translation.cached,
      segmentCount: translation.segments.length,
      transcriptHash: translation.transcriptHash,
    });
    console.log(JSON.stringify(translation.segments, null, 2));
    console.log(
      "[translated transcript]",
      JSON.stringify(
        translation.segments.map((segment) => ({
          index: segment.index,
          start: segment.start,
          end: segment.end,
          text: segment.translatedText,
        })),
        null,
        2,
      ),
    );

    return Response.json(translation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcript translation failed.";
    console.error("[youtube transcript translation error]", { message });

    return Response.json({ error: message }, { status: 502 });
  }
}

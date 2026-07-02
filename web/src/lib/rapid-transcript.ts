// Server-side transcript fetch via RapidAPI (youtube-transcriptor provider).
//
// Used by /api/youtube/transcript. Runs on the Next.js server so the API key
// stays out of the browser bundle and the client avoids CORS.
//
// Provider contract (youtube-transcriptor.p.rapidapi.com):
//   GET /transcript?video_id=<id>&lang=<lang>   (lang is REQUIRED)
//   → [{ ..., transcription: [{ subtitle, start, dur }, ...] }]

const RAPID_HOST =
  process.env.RAPIDAPI_HOST ??
  process.env.RAPID_API_HOST ??
  "youtube-transcriptor.p.rapidapi.com";

const RAPID_KEY =
  process.env.RAPIDAPI_KEY ??
  process.env.RAPID_API_KEY ??
  process.env.NEXT_PUBLIC_RAPID_API_KEY ??
  "";

// Caption language requested from the provider. Original-language captions are
// fine — the backend translates to Mongolian afterwards.
const RAPID_LANG = process.env.RAPID_API_LANG ?? "en";

const RAPID_URL = `https://${RAPID_HOST}/transcript`;

export type RapidSegment = { start: number; duration: number; text: string };

type RapidTranscriptItem = {
  subtitle?: string;
  text?: string;
  start?: number | string;
  dur?: number | string;
  duration?: number | string;
};

// youtube-transcriptor wraps its segments in a top-level array of one object
// that carries a `transcription` array.
type RapidTranscriptWrapper = {
  transcription?: RapidTranscriptItem[];
  availableLangs?: string[];
  lengthInSeconds?: number | string;
};

// youtube-transcriptor returns caption text with HTML entities left encoded
// (e.g. "I&#39;m", "&quot;", and occasionally double-encoded "&amp;#39;"). Decode
// them so translation/TTS receive clean text. &amp; is resolved first so any
// double-encoding collapses correctly.
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    !Number.isNaN(Number(value))
  ) {
    return Number(value);
  }
  return undefined;
}

// Pulls the `transcription` array out of youtube-transcriptor's array wrapper.
function transcriptItems(body: unknown): RapidTranscriptItem[] {
  if (Array.isArray(body)) {
    const wrapped = (body as RapidTranscriptWrapper[]).find(
      (item) => item && Array.isArray(item.transcription),
    );
    if (wrapped?.transcription) return wrapped.transcription;
    // Some responses may already be a flat array of segments.
    return body as RapidTranscriptItem[];
  }
  return [];
}

function toSegments(items: RapidTranscriptItem[]): RapidSegment[] {
  const segs: RapidSegment[] = items
    .map((item) => {
      const text = decodeEntities(String(item.subtitle ?? item.text ?? ""))
        .replace(/\s+/g, " ")
        .trim();
      const start = num(item.start) ?? 0;
      let duration = num(item.dur) ?? num(item.duration) ?? 0;
      if (!(duration > 0)) duration = 0;
      return { start, duration, text };
    })
    .filter((segment) => segment.text.length > 0);

  // Backfill missing durations from the next segment's start.
  for (let index = 0; index < segs.length; index++) {
    if (!segs[index].duration) {
      const next = segs[index + 1];
      segs[index].duration = next
        ? Math.max(0.5, next.start - segs[index].start)
        : 2;
    }
  }

  return segs;
}

export async function fetchRapidTranscript(
  videoId: string,
): Promise<{ segments: RapidSegment[]; source_lang: string }> {
  if (!RAPID_HOST || !RAPID_KEY) {
    throw new Error(
      "RapidAPI not configured: set RAPID_API_KEY and RAPID_API_HOST in the " +
        "server environment.",
    );
  }

  const url = `${RAPID_URL}?video_id=${encodeURIComponent(
    videoId,
  )}&lang=${encodeURIComponent(RAPID_LANG)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-rapidapi-key": RAPID_KEY,
      "x-rapidapi-host": RAPID_HOST,
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`RapidAPI ${res.status}: ${text.slice(0, 300)}`);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`RapidAPI ${res.status}: non-JSON response`);
  }

  const segments = toSegments(transcriptItems(body));
  if (!segments.length) {
    throw new Error(
      `RapidAPI ${res.status}: no transcript segments in response`,
    );
  }

  return { segments, source_lang: RAPID_LANG };
}

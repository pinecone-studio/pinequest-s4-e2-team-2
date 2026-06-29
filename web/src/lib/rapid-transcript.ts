// Server-side transcript fetch via the RapidAPI "video-transcript-scraper".
//
// Used by /api/youtube/transcript. Runs on the server so the API key stays out
// of the client bundle and there's no CORS. RapidAPI does the actual scraping
// from ITS own infrastructure, so this is NOT subject to the YouTube datacenter
// IP-block that broke the old in-house scraper on Vercel.

const RAPID_URL = process.env.NEXT_PUBLIC_RAPID_API_URL ?? "";
// Prefer the server-only key; fall back to the public one the test page uses so
// a single configured key works either way (403 "not subscribed" = no/wrong key).
const RAPID_KEY =
  process.env.RAPIDAPI_KEY ?? process.env.NEXT_PUBLIC_RAPID_API_KEY ?? "";
// RapidAPI requires x-rapidapi-host to match the endpoint's host exactly, so
// derive it from the URL instead of hardcoding (a mismatch also returns 403).
const RAPID_HOST = (() => {
  try {
    return new URL(RAPID_URL).host;
  } catch {
    return "video-transcript-scraper.p.rapidapi.com";
  }
})();

// What downstream (the /api/youtube/transcript route → pipeline) consumes.
export type RapidSegment = { start: number; duration: number; text: string };

// ── Response schema (RapidAPI "video-transcript-scraper") ───────────────────
// Each transcript item has start/end TIMESTAMPS (seconds), not a duration.
type RapidTranscriptItem = {
  text?: string;
  start?: number | string;
  end?: number | string;
  duration?: number | string; // tolerated if the API ever sends it instead
};

type RapidResponse = {
  status?: string;
  data?: {
    video_info?: {
      selected_language?: string;
      available_languages?: string[];
    };
    transcript?: RapidTranscriptItem[];
  };
  // Tolerate a flatter shape too, just in case.
  transcript?: RapidTranscriptItem[];
};

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

// Map raw items → clean {start, duration, text}. Duration is derived from the
// end timestamp (end - start); text is whitespace-collapsed and trimmed.
function toSegments(items: RapidTranscriptItem[]): RapidSegment[] {
  const segs: RapidSegment[] = items
    .map((it) => {
      const text = String(it.text ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const start = num(it.start) ?? 0;
      const end = num(it.end);
      const explicit = num(it.duration);
      let duration =
        explicit ?? (end !== undefined ? end - start : 0);
      if (!(duration > 0)) duration = 0;
      return { start, duration, text };
    })
    .filter((s) => s.text.length > 0);

  // Backfill any missing duration from the next segment's start.
  for (let i = 0; i < segs.length; i++) {
    if (!segs[i].duration) {
      const next = segs[i + 1];
      segs[i].duration = next ? Math.max(0.5, next.start - segs[i].start) : 2;
    }
  }

  return segs;
}

export async function fetchRapidTranscript(
  videoId: string,
): Promise<{ segments: RapidSegment[]; source_lang: string }> {
  if (!RAPID_URL || !RAPID_KEY) {
    throw new Error(
      "RapidAPI not configured: set NEXT_PUBLIC_RAPID_API_URL and RAPIDAPI_KEY " +
        "(or NEXT_PUBLIC_RAPID_API_KEY) in the server environment.",
    );
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const res = await fetch(RAPID_URL, {
    method: "POST",
    headers: {
      "x-rapidapi-key": RAPID_KEY,
      "x-rapidapi-host": RAPID_HOST,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ video_url: videoUrl }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RapidAPI ${res.status}: ${text.slice(0, 300)}`);
  }

  let body: RapidResponse;
  try {
    body = JSON.parse(text) as RapidResponse;
  } catch {
    throw new Error("RapidAPI returned non-JSON response");
  }

  const items = body.data?.transcript ?? body.transcript ?? [];
  const segments = toSegments(items);
  const source_lang = body.data?.video_info?.selected_language || "en";

  if (!segments.length) {
    console.warn(
      "[rapid-transcript] parsed 0 segments — response status:",
      body.status,
    );
  }

  return { segments, source_lang };
}

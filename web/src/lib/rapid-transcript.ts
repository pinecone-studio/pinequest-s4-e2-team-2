// Server-side transcript fetch via RapidAPI.
//
// Used by /api/youtube/transcript. This runs on the Next.js server so the API
// key stays out of the browser bundle and the client avoids CORS.

const CONFIGURED_RAPID_URL =
  process.env.RAPIDAPI_URL ??
  process.env.RAPID_API_URL ??
  process.env.NEXT_PUBLIC_RAPID_API_URL ??
  "";

const RAPID_KEY =
  process.env.RAPIDAPI_KEY ??
  process.env.RAPID_API_KEY ??
  process.env.NEXT_PUBLIC_RAPID_API_KEY ??
  "";

const CONFIGURED_RAPID_HOST =
  process.env.RAPIDAPI_HOST ?? process.env.RAPID_API_HOST ?? "";

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const RAPID_HOST =
  CONFIGURED_RAPID_HOST ||
  hostFromUrl(CONFIGURED_RAPID_URL) ||
  "video-transcript-scraper.p.rapidapi.com";

function defaultUrlForHost(host: string): string {
  if (host === "video-transcript-scraper.p.rapidapi.com") {
    return `https://${host}/transcript/youtube`;
  }
  return `https://${host}`;
}

const RAPID_URL = CONFIGURED_RAPID_URL || defaultUrlForHost(RAPID_HOST);

export type RapidSegment = { start: number; duration: number; text: string };

type RapidTranscriptItem = {
  text?: string;
  subtitle?: string;
  sentence?: string;
  line?: string;
  start?: number | string;
  offset?: number | string;
  startTime?: number | string;
  start_time?: number | string;
  start_ms?: number | string;
  startMs?: number | string;
  end?: number | string;
  endTime?: number | string;
  end_time?: number | string;
  end_ms?: number | string;
  endMs?: number | string;
  duration?: number | string;
  dur?: number | string;
  duration_ms?: number | string;
  durationMs?: number | string;
};

type RapidResponse = {
  status?: string;
  data?: {
    video_info?: {
      selected_language?: string;
      available_languages?: string[];
    };
    transcript?: RapidTranscriptItem[];
    transcripts?: RapidTranscriptItem[];
    segments?: RapidTranscriptItem[];
    captions?: RapidTranscriptItem[];
  };
  transcript?: RapidTranscriptItem[];
  transcripts?: RapidTranscriptItem[];
  segments?: RapidTranscriptItem[];
  captions?: RapidTranscriptItem[];
};

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

function millis(value: unknown): number | undefined {
  const parsed = num(value);
  return parsed === undefined ? undefined : parsed / 1000;
}

function firstNum(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => value !== undefined);
}

function transcriptItems(
  body: RapidResponse | RapidTranscriptItem[],
): RapidTranscriptItem[] {
  if (Array.isArray(body)) return body;
  const candidates = [
    body.data?.transcript,
    body.data?.transcripts,
    body.data?.segments,
    body.data?.captions,
    body.transcript,
    body.transcripts,
    body.segments,
    body.captions,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function withQuery(url: string, params: Record<string, string>): string {
  const next = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    next.searchParams.set(key, value);
  }
  return next.toString();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\/+$/, "")))];
}

function candidateBaseUrls(): string[] {
  if (RAPID_HOST === "video-transcript-scraper.p.rapidapi.com") {
    return [RAPID_URL];
  }
  if (CONFIGURED_RAPID_URL) {
    return [CONFIGURED_RAPID_URL];
  }

  const root = `https://${RAPID_HOST}`;
  return unique([
    root,
    `${root}/transcript`,
    `${root}/transcript/youtube`,
    `${root}/youtube/transcript`,
    `${root}/api/transcript`,
    `${root}/get-transcript`,
  ]);
}

function candidateRequests(
  videoId: string,
): Array<{ url: string; init: RequestInit }> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const headers = {
    "x-rapidapi-key": RAPID_KEY,
    "x-rapidapi-host": RAPID_HOST,
    "Content-Type": "application/json",
  };

  if (RAPID_HOST === "video-transcript-scraper.p.rapidapi.com") {
    return [
      {
        url: RAPID_URL,
        init: {
          method: "POST",
          headers,
          body: JSON.stringify({ video_url: videoUrl }),
        },
      },
    ];
  }

  return candidateBaseUrls().flatMap((baseUrl) => [
    {
      url: withQuery(baseUrl, { video_id: videoId }),
      init: { method: "GET", headers },
    },
    { url: withQuery(baseUrl, { videoId }), init: { method: "GET", headers } },
    {
      url: withQuery(baseUrl, { url: videoUrl }),
      init: { method: "GET", headers },
    },
    {
      url: baseUrl,
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({ video_id: videoId }),
      },
    },
    {
      url: baseUrl,
      init: { method: "POST", headers, body: JSON.stringify({ videoId }) },
    },
    {
      url: baseUrl,
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({ url: videoUrl }),
      },
    },
    {
      url: baseUrl,
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({ video_url: videoUrl }),
      },
    },
  ]);
}

function toSegments(items: RapidTranscriptItem[]): RapidSegment[] {
  const segs: RapidSegment[] = items
    .map((item) => {
      const text = String(
        item.text ?? item.subtitle ?? item.sentence ?? item.line ?? "",
      )
        .replace(/\s+/g, " ")
        .trim();
      const start =
        firstNum(
          num(item.start),
          num(item.offset),
          num(item.startTime),
          num(item.start_time),
          millis(item.start_ms),
          millis(item.startMs),
        ) ?? 0;
      const end = firstNum(
        num(item.end),
        num(item.endTime),
        num(item.end_time),
        millis(item.end_ms),
        millis(item.endMs),
      );
      const explicit = firstNum(
        num(item.duration),
        num(item.dur),
        millis(item.duration_ms),
        millis(item.durationMs),
      );
      let duration = explicit ?? (end !== undefined ? end - start : 0);
      if (!(duration > 0)) duration = 0;
      return { start, duration, text };
    })
    .filter((segment) => segment.text.length > 0);

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
      "RapidAPI not configured: set RAPID_API_KEY and either RAPID_API_URL " +
        "or RAPID_API_HOST in the server environment.",
    );
  }

  let lastError = "";
  for (const { url, init } of candidateRequests(videoId)) {
    const res = await fetch(url, init);
    const text = await res.text();
    const path = new URL(url).pathname || "/";

    if (!res.ok) {
      lastError = `RapidAPI ${res.status} (${path}): ${text.slice(0, 300)}`;
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        break;
      }
      continue;
    }

    let body: RapidResponse | RapidTranscriptItem[];
    try {
      body = JSON.parse(text) as RapidResponse | RapidTranscriptItem[];
    } catch {
      lastError = `RapidAPI ${res.status} (${path}): non-JSON response`;
      continue;
    }

    const items = transcriptItems(body);
    const segments = toSegments(items);
    if (segments.length) {
      const source_lang = Array.isArray(body)
        ? "en"
        : body.data?.video_info?.selected_language || "en";
      return { segments, source_lang };
    }

    lastError = `RapidAPI ${res.status} (${path}): no transcript segments in response`;
  }

  throw new Error(lastError || "RapidAPI transcript request failed");
}

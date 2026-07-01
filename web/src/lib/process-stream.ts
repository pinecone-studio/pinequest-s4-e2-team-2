// Client-side transcript fetch (Vercel route) + SSE streaming of the backend
// /process pipeline (translate + TTS), yielding one segment at a time.

export type TranscriptSegment = {
  start: number;
  duration: number;
  text: string;
  translated_text?: string | null;
};
export type TranscriptResponse = {
  video_id: string;
  source_lang: string;
  segments: TranscriptSegment[];
};

// Raw YouTube captions arrive as tiny fragments ("In that", "context, we have")
// that lose meaning when translated/dubbed one-by-one. Merge consecutive
// fragments into whole sentences so translation + TTS get full context. A group
// closes on sentence-ending punctuation, a long pause, or a safety length cap
// (auto-captions sometimes carry no punctuation at all).
export function groupIntoSentences(
  segments: TranscriptSegment[],
): TranscriptSegment[] {
  const MAX_CHARS = 240; // cap when captions lack punctuation
  const MAX_GAP = 2.0; // seconds of silence that also ends a sentence
  const ENDS_SENTENCE = /[.!?…]['")\]]*$/;

  const grouped: TranscriptSegment[] = [];
  let buf: { start: number; end: number; text: string } | null = null;

  const flush = () => {
    if (!buf) return;
    const text = buf.text.replace(/\s+/g, " ").trim();
    if (text) {
      grouped.push({
        start: buf.start,
        duration: Math.max(0.5, buf.end - buf.start),
        text,
      });
    }
    buf = null;
  };

  for (const seg of segments) {
    const piece = seg.text.replace(/\s+/g, " ").trim();
    if (!piece) continue;
    const segEnd = seg.start + (seg.duration || 0);

    // A long gap before this fragment means the previous sentence is over.
    if (buf && seg.start - buf.end > MAX_GAP) flush();

    if (!buf) {
      buf = { start: seg.start, end: segEnd, text: piece };
    } else {
      buf.text += ` ${piece}`;
      buf.end = segEnd;
    }

    if (ENDS_SENTENCE.test(buf.text) || buf.text.length >= MAX_CHARS) flush();
  }
  flush();

  return grouped;
}

// One segment as streamed back by the backend over SSE.
export type StreamedSegment = {
  offset: number; // seconds
  duration: number; // seconds
  text: string;
  translated_text: string;
  audio_b64: string; // MP3 bytes, base64
  audio_ms: number;
};

export type StreamHandlers = {
  onSegment: (segment: StreamedSegment, index: number, total: number) => void;
  onDone?: (total: number) => void;
  onError?: (message: string) => void;
};

function backendUrl(path: string): string {
  let base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
  // Guarantee a scheme so the request actually leaves the frontend origin.
  if (base && !/^https?:\/\//.test(base)) base = `http://${base}`;
  return `${base}${path}`;
}

// Fetches the transcript from our own Vercel API route (same-origin, no CORS).
export async function fetchTranscript(
  videoId: string,
  signal?: AbortSignal,
): Promise<TranscriptResponse> {
  console.log("[fetchTranscript] → requesting transcript", { videoId });
  const startedAt = Date.now();

  const res = await fetch(
    `/api/youtube/transcript?videoId=${encodeURIComponent(videoId)}`,
    { signal },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string; detail?: string }
      | null;
    console.error("[fetchTranscript] ✗ request failed", {
      videoId,
      status: res.status,
      statusText: res.statusText,
      tookMs: Date.now() - startedAt,
      error: body?.error,
      detail: body?.detail,
    });
    throw new Error(body?.error || `Transcript fetch failed (${res.status}).`);
  }

  const data = (await res.json()) as TranscriptResponse;
  // Merge fragment captions into sentences before anything translates/dubs them.
  const segments = groupIntoSentences(data.segments ?? []);
  console.log("[fetchTranscript] ← transcript received", {
    videoId,
    sourceLang: data.source_lang,
    rawSegmentCount: data.segments?.length ?? 0,
    sentenceCount: segments.length,
    tookMs: Date.now() - startedAt,
  });
  return { ...data, segments };
}

// POSTs the segments to the backend and consumes the SSE stream, invoking
// handlers as each translated + dubbed segment arrives.
export async function streamProcess(
  payload: {
    video_id?: string;
    source_lang: string;
    segments: TranscriptSegment[];
    gender?: string;
    voice?: string;
    tts?: boolean; // false = translate-only (subtitles), no audio synthesis
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const url = backendUrl("/process");
  console.log("[streamProcess] → sending transcript to backend", {
    url,
    videoId: payload.video_id,
    sourceLang: payload.source_lang,
    segmentCount: payload.segments.length,
    totalChars: payload.segments.reduce((n, s) => n + s.text.length, 0),
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    console.error("[streamProcess] ✗ backend rejected request", {
      url,
      status: response.status,
      statusText: response.statusText,
      hasBody: !!response.body,
      detail,
    });
    throw new Error(detail || `Process failed (${response.status}).`);
  }

  console.log("[streamProcess] ← stream opened, reading segments", {
    status: response.status,
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (signal?.aborted) { reader.cancel(); break; }
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? ""; // keep the trailing incomplete chunk

    for (const part of parts) {
      const line = part.replace(/^data: /, "").trim();
      if (!line) continue;

      let msg: {
        error?: string;
        done?: boolean;
        total?: number;
        index?: number;
        segment?: StreamedSegment;
      };
      try {
        msg = JSON.parse(line);
      } catch (err) {
        console.error("[streamProcess] ✗ failed to parse SSE line", {
          line: line.slice(0, 500),
          error: err instanceof Error ? err.message : String(err),
        });
        continue; // skip the bad frame rather than killing the whole stream
      }

      if (msg.error) {
        console.error("[streamProcess] ✗ backend reported error", { error: msg.error });
        handlers.onError?.(msg.error);
      } else if (msg.done) {
        console.log("[streamProcess] ← stream done", { total: msg.total });
        handlers.onDone?.(msg.total ?? 0);
      } else if (msg.segment) {
        handlers.onSegment(msg.segment, msg.index ?? 0, msg.total ?? 0);
      }
    }
  }
}

// Decodes base64 MP3 bytes into a playable object URL.
export function base64ToBlobUrl(b64: string, mime = "audio/mpeg"): string | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch (err) {
    console.error("[base64ToBlobUrl] decode failed:", err);
    return null;
  }
}

// Client-side transcript fetch (Vercel route) + SSE streaming of the backend
// /process pipeline (translate + TTS), yielding one segment at a time.

export type TranscriptSegment = { start: number; duration: number; text: string };
export type TranscriptResponse = {
  video_id: string;
  source_lang: string;
  segments: TranscriptSegment[];
};

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
  console.log("[fetchTranscript] ← transcript received", {
    videoId,
    sourceLang: data.source_lang,
    segmentCount: data.segments?.length ?? 0,
    tookMs: Date.now() - startedAt,
  });
  return data;
}

// POSTs the segments to the backend and consumes the SSE stream, invoking
// handlers as each translated + dubbed segment arrives.
export async function streamProcess(
  payload: { source_lang: string; segments: TranscriptSegment[]; gender?: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const url = backendUrl("/process");
  console.log("[streamProcess] → sending transcript to backend", {
    url,
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
export function base64ToBlobUrl(b64: string, mime = "audio/mpeg"): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

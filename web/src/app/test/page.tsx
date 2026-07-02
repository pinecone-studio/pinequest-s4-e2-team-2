"use client";

// Diagnostics page for the caption-fetch pipeline.
//
// Hits our OWN server route (/api/youtube/transcript), which runs the
// youtube-transcriptor provider server-side (lib/rapid-transcript.ts). This is
// the exact path the real app uses, so whatever breaks here breaks there too.
// We render everything: request URL, HTTP status, timing, response headers, and
// the raw body — so you can see exactly what went wrong.
//
// NOTE: we deliberately do NOT call RapidAPI directly from the browser — the
// key is server-only (no NEXT_PUBLIC_ prefix) and calling it here would leak it
// and hit an empty host.

import { useState } from "react";

// Pull the 11-char video ID out of whatever was pasted (full URL, youtu.be,
// shorts, or a raw ID).
function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    const v = u.searchParams.get("v");
    if (v) return v;
    const last = u.pathname.split("/").filter(Boolean).at(-1);
    if (last && /^[a-zA-Z0-9_-]{11}$/.test(last)) return last;
  } catch {
    // not a URL — fall through
  }
  return null;
}

type Diagnostics = {
  requestUrl: string;
  videoId: string;
  status: number;
  statusText: string;
  ok: boolean;
  elapsedMs: number;
  headers: Record<string, string>;
  rawBody: string;
  parsed: unknown;
  parseError?: string;
};

export default function Page() {
  const [url, setUrl] = useState("");
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setError("");
    setDiag(null);

    if (!url.trim()) {
      setError("Paste a YouTube URL first");
      return;
    }
    const videoId = extractVideoId(url);
    if (!videoId) {
      setError("Could not parse a video ID from that input");
      return;
    }

    const requestUrl = `/api/youtube/transcript?videoId=${encodeURIComponent(
      videoId,
    )}`;
    console.groupCollapsed(`[test] transcript fetch → ${videoId}`);
    console.log("request url:", requestUrl);

    setLoading(true);
    const startedAt = performance.now();
    try {
      const res = await fetch(requestUrl, { method: "GET" });
      const elapsedMs = Math.round(performance.now() - startedAt);
      const rawBody = await res.text();

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      let parsed: unknown = null;
      let parseError: string | undefined;
      try {
        parsed = JSON.parse(rawBody);
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }

      const result: Diagnostics = {
        requestUrl,
        videoId,
        status: res.status,
        statusText: res.statusText,
        ok: res.ok,
        elapsedMs,
        headers,
        rawBody,
        parsed,
        parseError,
      };

      console.log("status:", res.status, res.statusText, `(${elapsedMs}ms)`);
      console.log("headers:", headers);
      console.log("raw body:", rawBody);
      if (parseError) console.warn("body was not JSON:", parseError);
      else console.log("parsed body:", parsed);

      if (!res.ok) {
        const detail =
          parsed && typeof parsed === "object"
            ? JSON.stringify(parsed)
            : rawBody;
        setError(`HTTP ${res.status} ${res.statusText} — ${detail}`);
        console.error("[test] request failed", result);
      }

      setDiag(result);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error("[test] fetch threw:", e);
      setError(`Network/fetch error — ${msg}`);
    } finally {
      console.groupEnd();
      setLoading(false);
    }
  }

  const segmentCount =
    diag?.parsed &&
    typeof diag.parsed === "object" &&
    Array.isArray((diag.parsed as { segments?: unknown }).segments)
      ? (diag.parsed as { segments: unknown[] }).segments.length
      : null;

  return (
    <div className="w-screen min-h-screen p-10 flex flex-col gap-5">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="yt url or video id"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) run();
          }}
        />
        <button
          className="rounded border px-4 py-2 hover:bg-slate-400/50 disabled:opacity-50"
          onClick={run}
          disabled={loading}
        >
          {loading ? "Fetching..." : "Fetch"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400 whitespace-pre-wrap">
          <strong>Error:</strong> {error}
        </div>
      )}

      {diag && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat label="Request" value={diag.requestUrl} />
          <Stat label="Video ID" value={diag.videoId} />
          <Stat
            label="HTTP status"
            value={`${diag.status} ${diag.statusText}`}
            bad={!diag.ok}
          />
          <Stat label="Elapsed" value={`${diag.elapsedMs} ms`} />
          <Stat
            label="Segments parsed"
            value={segmentCount === null ? "—" : String(segmentCount)}
            bad={segmentCount === 0}
          />
          <Stat
            label="Body is JSON"
            value={diag.parseError ? `no (${diag.parseError})` : "yes"}
            bad={!!diag.parseError}
          />
        </div>
      )}

      {diag && (
        <details className="text-xs" open>
          <summary className="cursor-pointer py-1 text-zinc-400">
            Response headers
          </summary>
          <pre className="overflow-auto whitespace-pre-wrap rounded bg-zinc-900 p-3 text-zinc-100">
            {JSON.stringify(diag.headers, null, 2)}
          </pre>
        </details>
      )}

      <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded bg-zinc-900 p-3 text-xs text-zinc-100">
        {diag
          ? diag.parseError
            ? diag.rawBody
            : JSON.stringify(diag.parsed, null, 2)
          : "No response yet."}
      </pre>
    </div>
  );
}

function Stat({
  label,
  value,
  bad,
}: {
  label: string;
  value: string;
  bad?: boolean;
}) {
  return (
    <div className="rounded border border-zinc-700 p-2">
      <div className="text-zinc-500">{label}</div>
      <div
        className={`break-all font-mono ${bad ? "text-red-400" : "text-zinc-200"}`}
      >
        {value}
      </div>
    </div>
  );
}

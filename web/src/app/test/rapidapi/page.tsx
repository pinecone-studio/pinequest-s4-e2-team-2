"use client";

// Small test page: hit the RapidAPI YouTube transcript scraper with a pasted
// URL and dump the raw response. (Test only — key is inline on purpose.)

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_RAPID_API_URL!;
const API_KEY = process.env.NEXT_PUBLIC_RAPID_API_KEY!;

export default function Page() {
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!url.trim()) {
      setError("Paste a YouTube URL first");
      return;
    }
    setLoading(true);
    setError("");
    setTranscript("");
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "x-rapidapi-key": API_KEY,
          "x-rapidapi-host": "video-transcript-scraper.p.rapidapi.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ video_url: url.trim() }),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      // Pretty-print if it's JSON, otherwise show raw text.
      try {
        setTranscript(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setTranscript(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-screen h-screen p-10 flex flex-col gap-5">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border px-3 py-2"
          placeholder="yt url paste"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="rounded border px-4 py-2 hover:bg-slate-400/50 disabled:opacity-50"
          onClick={run}
          disabled={loading}
        >
          {loading ? "Fetching..." : "Fetch"}
        </button>
      </div>

      {error && <p className="text-red-500">{error}</p>}

      <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded bg-zinc-900 p-3 text-xs text-zinc-100">
        {transcript || "No transcript yet."}
      </pre>
    </div>
  );
}

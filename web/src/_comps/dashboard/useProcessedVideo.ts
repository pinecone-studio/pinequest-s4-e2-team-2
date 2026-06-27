"use client";

import { useEffect, useState } from "react";
import type { Segment } from "@/lib/backend-api";
import { fetchTranscript, streamProcess } from "@/lib/process-stream";

// Loads captions for the selected video (Path A, client-side via Vercel route)
// then streams Mongolian translation + TTS audio from the backend /process SSE.
// Segments are shown in English immediately and updated as each dubbed segment
// arrives so the subtitle pane is never empty while waiting for the backend.
export function useProcessedVideo(videoId: string) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!videoId) {
      setSegments([]);
      setError("");
      setLoading(false);
      return;
    }

    let active = true;
    const abortController = new AbortController();

    setSegments([]);
    setError("");
    setLoading(true);
    console.log("[useProcessedVideo] fetching captions for", videoId);

    (async () => {
      try {
        const transcript = await fetchTranscript(videoId);
        if (!active) return;

        if (!transcript.segments.length) {
          setError("No transcript available for this video.");
          setLoading(false);
          return;
        }

        // Show English captions immediately so the UI is never empty.
        const initial: Segment[] = transcript.segments.map((s) => ({
          start: s.start,
          duration: s.duration,
          text: s.text,
          source: "youtube_captions",
          translated_text: null,
          audio_path: null,
          audio_ms: null,
          audio_b64: null,
        }));
        setSegments(initial);
        setLoading(false);
        console.log(`[useProcessedVideo] loaded ${initial.length} caption segments`);

        // Stream Mongolian translation + TTS audio from the backend.
        // Each segment updates in-place as it arrives — subtitle pane auto-switches.
        streamProcess(
          { source_lang: transcript.source_lang, segments: transcript.segments },
          {
            onSegment: (streamed, index) => {
              if (!active) return;
              setSegments((prev) => {
                const next = [...prev];
                if (next[index]) {
                  next[index] = {
                    ...next[index],
                    translated_text: streamed.translated_text,
                    audio_b64: streamed.audio_b64,
                    audio_ms: streamed.audio_ms,
                  };
                }
                return next;
              });
            },
            onError: (msg) => {
              if (!active) return;
              console.warn("[useProcessedVideo] streamProcess error:", msg);
            },
            onDone: (total) => {
              console.log(`[useProcessedVideo] dub complete: ${total} segments`);
            },
          },
          abortController.signal,
        ).catch((err) => {
          if (!active) return;
          console.warn("[useProcessedVideo] streamProcess failed:", err);
        });
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Transcript fetch failed.");
        setLoading(false);
      }
    })();

    return () => {
      active = false;
      abortController.abort();
    };
  }, [videoId]);

  return { segments, loading, error };
}

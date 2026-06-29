"use client";

import { useEffect, useState } from "react";
import { saveCachedVideoTranscript, type Segment } from "@/lib/backend-api";
import { fetchTranscript } from "@/lib/process-stream";

// Loads the caption transcript for the selected video and exposes it as Segment[].
// Caption-only: translation + TTS is handled by useDubAudio when dub mode is on.
export function useProcessedVideo(videoId: string) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sourceLang, setSourceLang] = useState("en");

  useEffect(() => {
    if (!videoId) {
      queueMicrotask(() => {
        setSegments([]);
        setError("");
        setLoading(false);
      });
      return;
    }

    let active = true;

    queueMicrotask(() => {
      if (!active) return;
      setSegments([]);
      setError("");
      setLoading(true);
    });
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

        const mapped: Segment[] = transcript.segments.map((s) => ({
          start: s.start,
          duration: s.duration,
          text: s.text,
          source: "youtube_captions",
          translated_text: null,
          audio_path: null,
          audio_ms: null,
          audio_b64: null,
        }));

        setSegments(mapped);
        setSourceLang(transcript.source_lang || "en");
        setLoading(false);
        void saveCachedVideoTranscript({
          video_id: videoId,
          source_lang: transcript.source_lang,
          segments: transcript.segments,
        }).catch((saveError) => {
          console.warn("Transcript cache save failed:", saveError);
        });
        console.log(`[useProcessedVideo] loaded ${mapped.length} caption segments`);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Transcript fetch failed.");
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [videoId]);

  return { segments, loading, error, sourceLang };
}

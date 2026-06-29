"use client";

import { useEffect, useState } from "react";
import type { Segment } from "@/lib/backend-api";
import {
  streamProcess,
  type StreamedSegment,
  type TranscriptSegment,
} from "@/lib/process-stream";

// Takes the already-fetched (RapidAPI) caption segments, sends them to the
// backend /process pipeline in TRANSLATE-ONLY mode (no TTS), and returns the
// same segments with `translated_text` filled in — for the SubtitlePane to show
// Mongolian instead of the original English. Audio dubbing stays in useDubAudio.
export function useTranslatedSubtitles(
  videoId: string,
  sourceSegments: Segment[],
  sourceLang: string = "en",
) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!videoId || sourceSegments.length === 0) {
      setSegments([]);
      setLoading(false);
      setError("");
      return;
    }

    let active = true;
    const controller = new AbortController();
    setSegments([]);
    setError("");
    setLoading(true);

    // Pre-build the result array so translations can be placed by index as the
    // SSE stream delivers them (out-of-order delivery is fine).
    const built: Segment[] = sourceSegments.map((s) => ({
      start: s.start,
      duration: s.duration,
      text: s.text,
      source: "youtube_captions",
      translated_text: null,
      audio_path: null,
      audio_ms: null,
      audio_b64: null,
    }));

    const payload: TranscriptSegment[] = sourceSegments.map((s) => ({
      start: s.start,
      duration: s.duration,
      text: s.text,
    }));

    void streamProcess(
      { source_lang: sourceLang, segments: payload, tts: false },
      {
        onSegment: (seg: StreamedSegment, index: number) => {
          if (!active) return;
          if (index >= 0 && index < built.length) {
            built[index] = {
              ...built[index],
              translated_text: seg.translated_text || null,
            };
          }
          setSegments([...built]);
        },
        onDone: () => {
          if (active) setLoading(false);
        },
        onError: (msg) => {
          if (!active) return;
          setError(msg);
          setLoading(false);
        },
      },
      controller.signal,
    ).catch((err) => {
      if (!active || controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Translation failed.");
      setLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [videoId, sourceSegments, sourceLang]);

  return { segments, loading, error };
}

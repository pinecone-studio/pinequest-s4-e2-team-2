import { useEffect, useState } from "react";
import type { YouTubeTranscript } from "@/lib/youtube-transcript";

export type TranscriptState = {
  data: YouTubeTranscript | null;
  error: string;
  isLoading: boolean;
};

export function useTranscriptLogger(videoId: string) {
  const [state, setState] = useState<TranscriptState>({
    data: null,
    error: "",
    isLoading: false,
  });

  useEffect(() => {
    if (!videoId) return;

    const controller = new AbortController();

    async function loadTranscript() {
      setState({ data: null, error: "", isLoading: true });

      try {
        const response = await fetch(`/api/youtube/transcript?videoId=${videoId}`, {
          signal: controller.signal,
        });
        const data = await response.json();

        if (response.ok) {
          console.log("[youtube transcript stored]", {
            videoId: data.videoId,
            language: data.language,
            source: data.source,
            segmentCount: data.segments?.length ?? 0,
          });
          console.log("[youtube transcript segments]", data.segments);
        } else {
          console.error("[youtube transcript response error]", data);
        }

        setState({
          data: response.ok ? data : null,
          error: response.ok ? "" : data.error ?? `Transcript API failed: ${response.status}`,
          isLoading: false,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;

        console.error("[youtube transcript response error]", error);
        setState({
          data: null,
          error: error instanceof Error ? error.message : "Transcript request failed.",
          isLoading: false,
        });
      }
    }

    loadTranscript();

    return () => {
      controller.abort();
    };
  }, [videoId]);

  return state;
}

import { useEffect, useState } from "react";
import type {
  TranslatedTranscriptSegment,
  YouTubeTranscriptTranslation,
} from "@/lib/transcript-translation";
import type { YouTubeTranscript } from "@/lib/youtube-transcript";

const TRANSLATION_CHUNK_SIZE = 30;

function readApiError(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }

  return fallback;
}

export type TranscriptState = {
  data: YouTubeTranscript | null;
  translation: YouTubeTranscriptTranslation | null;
  error: string;
  translationError: string;
  isLoading: boolean;
  isTranslating: boolean;
};

export function useTranscriptLogger(videoId: string) {
  const [state, setState] = useState<TranscriptState>({
    data: null,
    translation: null,
    error: "",
    translationError: "",
    isLoading: false,
    isTranslating: false,
  });

  useEffect(() => {
    if (!videoId) return;

    const controller = new AbortController();

    async function loadTranscript() {
      setState({
        data: null,
        translation: null,
        error: "",
        translationError: "",
        isLoading: true,
        isTranslating: false,
      });

      try {
        const response = await fetch(`/api/youtube/transcript?videoId=${videoId}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as YouTubeTranscript | { error?: string };

        if (response.ok) {
          const transcript = data as YouTubeTranscript;

          console.log("[youtube transcript stored]", {
            videoId: transcript.videoId,
            language: transcript.language,
            source: transcript.source,
            segmentCount: transcript.segments.length,
          });
          console.log("[youtube transcript segments]", transcript.segments);

          setState({
            data: transcript,
            translation: null,
            error: "",
            translationError: "",
            isLoading: false,
            isTranslating: true,
          });

          try {
            const translation = await loadTranslation(transcript, controller.signal);
            if (!translation) return;

            setState((prev) => ({
              ...prev,
              translation,
              translationError: "",
              isTranslating: false,
            }));
          } catch (error) {
            setState((prev) => ({
              ...prev,
              translation: null,
              translationError:
                error instanceof Error ? error.message : "Transcript translation failed.",
              isTranslating: false,
            }));
          }
        } else {
          console.error("[youtube transcript response error]", data);
          setState({
            data: null,
            translation: null,
            error: readApiError(data, `Transcript API failed: ${response.status}`),
            translationError: "",
            isLoading: false,
            isTranslating: false,
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;

        console.error("[youtube transcript response error]", error);
        setState({
          data: null,
          translation: null,
          error: error instanceof Error ? error.message : "Transcript request failed.",
          translationError: "",
          isLoading: false,
          isTranslating: false,
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

async function loadTranslation(transcript: YouTubeTranscript, signal: AbortSignal) {
  const chunks = getTranscriptChunks(transcript);
  const translatedSegments: TranslatedTranscriptSegment[] = [];
  let combinedTranslation: YouTubeTranscriptTranslation | null = null;

  try {
    console.log("[youtube transcript translation request]", {
      videoId: transcript.videoId,
      language: transcript.language,
      segmentCount: transcript.segments.length,
      chunkCount: chunks.length,
    });

    for (const chunk of chunks) {
      console.log("[youtube transcript translation chunk request]", {
        videoId: transcript.videoId,
        chunk: chunk.chunkNumber,
        chunkCount: chunks.length,
        startIndex: chunk.startIndex,
        segmentCount: chunk.transcript.segments.length,
      });

      const translation = await requestTranslationChunk(chunk.transcript, signal);
      const rebasedSegments = translation.segments.map((segment) => ({
        ...segment,
        index: chunk.startIndex + segment.index,
      }));

      translatedSegments.push(...rebasedSegments);
      combinedTranslation = {
        ...translation,
        videoId: transcript.videoId,
        sourceLanguage: transcript.language,
        cached: translation.cached,
        segments: [...translatedSegments].sort((left, right) => left.index - right.index),
      };

      console.log("[translated transcript chunk]", {
        chunk: chunk.chunkNumber,
        chunkCount: chunks.length,
        startIndex: chunk.startIndex,
        translatedCount: rebasedSegments.length,
        segments: rebasedSegments.map((segment) => ({
          index: segment.index,
          start: segment.start,
          end: segment.end,
          text: segment.translatedText,
        })),
      });
      console.log("[translated transcript progress]", {
        translatedCount: translatedSegments.length,
        totalCount: transcript.segments.length,
      });

      if (signal.aborted) return null;
    }

    if (!combinedTranslation) {
      throw new Error("Transcript translation returned no chunks.");
    }

    console.log("[youtube transcript translation stored]", {
      videoId: combinedTranslation.videoId,
      sourceLanguage: combinedTranslation.sourceLanguage,
      targetLanguage: combinedTranslation.targetLanguage,
      model: combinedTranslation.model,
      cached: combinedTranslation.cached,
      segmentCount: combinedTranslation.segments.length,
      transcriptHash: combinedTranslation.transcriptHash,
    });
    console.log("[youtube transcript translated segments]", combinedTranslation.segments);
    console.log(
      "[translated transcript]",
      combinedTranslation.segments.map((segment) => ({
        index: segment.index,
        start: segment.start,
        end: segment.end,
        text: segment.translatedText,
      })),
    );

    return combinedTranslation;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;

    console.log("[translated transcript]", {
      error: error instanceof Error ? error.message : "Transcript translation failed.",
      segments: [],
    });
    console.error("[youtube transcript translation response error]", error);
    throw error;
  }
}

function getTranscriptChunks(transcript: YouTubeTranscript) {
  const chunks: Array<{
    chunkNumber: number;
    startIndex: number;
    transcript: YouTubeTranscript;
  }> = [];

  for (let startIndex = 0; startIndex < transcript.segments.length; startIndex += TRANSLATION_CHUNK_SIZE) {
    chunks.push({
      chunkNumber: chunks.length + 1,
      startIndex,
      transcript: {
        ...transcript,
        segments: transcript.segments.slice(startIndex, startIndex + TRANSLATION_CHUNK_SIZE),
      },
    });
  }

  return chunks;
}

async function requestTranslationChunk(transcript: YouTubeTranscript, signal: AbortSignal) {
  const response = await fetch("/api/youtube/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify(transcript),
  });
  const data = (await response.json()) as YouTubeTranscriptTranslation | { error?: string };

  console.log("[youtube transcript translation api response]", {
    ok: response.ok,
    status: response.status,
    hasSegments:
      data && typeof data === "object" && "segments" in data && Array.isArray(data.segments),
    segmentCount:
      data && typeof data === "object" && "segments" in data && Array.isArray(data.segments)
        ? data.segments.length
        : 0,
    error: readApiError(data, ""),
  });

  if (!response.ok) {
    const message = readApiError(data, `Transcript translation failed: ${response.status}`);
    console.log("[translated transcript]", {
      error: message,
      segments: [],
    });
    throw new Error(message);
  }

  return data as YouTubeTranscriptTranslation;
}

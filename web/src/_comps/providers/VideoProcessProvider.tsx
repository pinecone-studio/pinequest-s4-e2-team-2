"use client";

// Single source of truth for EVERYTHING that happens to a video:
//   search  → select → process (fetch captions → translate → dub)
// All the actions + the whole pipeline live here so any component can drive or
// observe them through one hook: `useVideoProcess()`.
//
//   video searching  → videoAction = "searching"
//   video selected   → videoAction = "selecting"
//   pipeline running  → videoAction = "processing"
//   user cancelled    → videoAction = "cancelled"
//
// The pipeline itself is composed from the existing dashboard hooks (player +
// captions + translated subtitles + dub) so there's exactly one instance of each
// running, and one place that owns their combined state.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fetchYouTubeResults } from "@/_comps/youtube-search/api";
import { getYouTubeVideoId } from "@/_comps/youtube-search/utils";
import { FALLBACK_DURATION } from "@/_comps/dashboard/data";
import { useYouTubePlayer } from "@/_comps/dashboard/useYouTubePlayer";
import { useProcessedVideo } from "@/_comps/dashboard/useProcessedVideo";
import { useTranslatedSubtitles } from "@/_comps/dashboard/useTranslatedSubtitles";
import { useDubAudio } from "@/_comps/dashboard/useDubAudio";
import { DEFAULT_VOICE_ID, VOICES, type Voice } from "@/_comps/dashboard/voices";
import type { ProcessStage } from "@/_comps/dashboard/VideoPane";
import type { YouTubeSearchResult } from "@/lib/youtube-search";
import type { Segment } from "@/lib/backend-api";

export type VideoActionType =
  | "searching"
  | "processing"
  | "selecting"
  | "cancelled";

// The lightweight description of the video currently being watched/processed.
export type VideoSelection = {
  url: string;
  title?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
};

type DubMode = "mongolian" | "original";
type VoiceGender = "male" | "female";

interface VideoProcessContextType {
  // ── State machine ────────────────────────────────────────────────
  videoAction: VideoActionType | null;
  setVideoAction: (action: VideoActionType | null) => void;

  // ── Selection ────────────────────────────────────────────────────
  selectedVideo: VideoSelection | null;
  videoId: string;

  // ── Actions (the three the whole app drives through) ─────────────
  searchVideo: (query: string, signal?: AbortSignal) => Promise<void>;
  selectVideo: (url: string, meta?: Omit<VideoSelection, "url">) => void;
  processVideo: (url: string, meta?: Omit<VideoSelection, "url">) => void;
  cancel: () => void;

  // ── Search results ───────────────────────────────────────────────
  searchResults: YouTubeSearchResult[];
  isSearching: boolean;
  searchError: string;
  clearSearch: () => void;

  // ── Player (container rendered by the consumer) ──────────────────
  player: ReturnType<typeof useYouTubePlayer>;

  // ── Pipeline output ──────────────────────────────────────────────
  processedSegments: Segment[];
  translatedSegments: Segment[];
  subtitleSegments: Segment[]; // what the SubtitlePane should render right now
  sourceLang: string;
  processStage: ProcessStage;
  processProgress: number | null;

  // ── Dub controls ─────────────────────────────────────────────────
  dubMode: DubMode;
  toggleDub: () => void;
  voiceGender: VoiceGender;
  toggleGender: () => void;
  voices: Voice[];
  selectedVoiceId: string;
  selectVoice: (id: string) => void;
  dub: ReturnType<typeof useDubAudio>;
}

export const VideoProcessContext = createContext<
  VideoProcessContextType | undefined
>(undefined);

export const VideoProcessProvider = ({ children }: { children: ReactNode }) => {
  const [videoAction, setVideoAction] = useState<VideoActionType | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<VideoSelection | null>(
    null,
  );
  // Dub is ON by default — selecting a video should translate + dub in one pass
  // (the subtitle-only translate path stays idle while dubbing, see below).
  const [dubMode, setDubMode] = useState<DubMode>("mongolian");
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("male");
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(DEFAULT_VOICE_ID);

  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchAbortRef = useRef<AbortController | null>(null);

  const videoId = useMemo(
    () => (selectedVideo ? getYouTubeVideoId(selectedVideo.url) ?? "" : ""),
    [selectedVideo],
  );

  // ── Pipeline: one instance of each stage, wired together ───────────────
  const segmentDuration = selectedVideo?.durationSeconds ?? FALLBACK_DURATION;
  const player = useYouTubePlayer(videoId, segmentDuration);

  const {
    segments: processedSegments,
    loading: processingLoading,
    error: processingError,
    sourceLang,
  } = useProcessedVideo(videoId);

  // Translate-only subtitles run ONLY when NOT dubbing. While dubbing, the dub
  // job (useDubAudio) already returns Mongolian text, so translating again here
  // would double the work and let two different translations fight over the
  // subtitle layer.
  const translatedSubs = useTranslatedSubtitles(
    videoId,
    processedSegments,
    sourceLang,
    dubMode !== "mongolian",
  );

  const dub = useDubAudio(
    videoId,
    player.time,
    player.playing,
    dubMode === "mongolian",
    processedSegments,
    sourceLang,
    selectedVoiceId,
    player.playbackRate,
  );

  // Which segments the subtitle layer should show: the dub's translated text
  // when dubbing, otherwise the (cheaper) translate-only subtitles, otherwise
  // the raw captions while everything is still loading.
  const subtitleSegments: Segment[] =
    dubMode === "mongolian" && dub.translatedSegments.length > 0
      ? dub.translatedSegments
      : translatedSubs.segments.length > 0
        ? translatedSubs.segments
        : processedSegments;

  // Staged status for the "process" overlay: fetch → translate → dub → ready.
  const translatedCount = translatedSubs.segments.filter(
    (s) => s.translated_text,
  ).length;
  let processStage: ProcessStage = "idle";
  let processProgress: number | null = null;
  if (videoId) {
    if (processingError) {
      // Caption fetch failed — can't show anything.
      processStage = "error";
    } else if (processingLoading) {
      processStage = "fetching";
    } else if (translatedSubs.loading) {
      processStage = "translating";
      processProgress = processedSegments.length
        ? translatedCount / processedSegments.length
        : null;
    } else if (
      dub.step === "fetching" ||
      dub.step === "translating" ||
      dub.step === "tts"
    ) {
      processStage = "dubbing";
      processProgress = dub.progress
        ? dub.progress.done / dub.progress.total
        : null;
    } else if (processedSegments.length > 0) {
      processStage = "ready";
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────
  const clearSearch = useCallback(() => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setIsSearching(false);
    setSearchResults([]);
    setSearchError("");
  }, []);

  const searchVideo = useCallback(
    async (query: string, signal?: AbortSignal) => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        setSearchError("Search query must be at least 2 characters.");
        setSearchResults([]);
        return;
      }

      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      signal?.addEventListener("abort", () => controller.abort());

      setVideoAction("searching");
      setIsSearching(true);
      setSearchError("");

      try {
        const results = await fetchYouTubeResults(trimmed, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setSearchResults(results);
        if (results.length === 0) {
          setSearchError("No results found. Try another query.");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchResults([]);
        setSearchError(
          error instanceof Error ? error.message : "YouTube search failed.",
        );
      } finally {
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
        }
        if (!controller.signal.aborted) {
          setIsSearching(false);
          setVideoAction((a) => (a === "searching" ? null : a));
        }
      }
    },
    [],
  );

  const selectVideo = useCallback(
    (url: string, meta?: Omit<VideoSelection, "url">) => {
      clearSearch();
      setVideoAction("selecting");
      setSelectedVideo({ url, ...meta });
    },
    [clearSearch],
  );

  // Same as selecting a video — the pipeline runs automatically once a video is
  // selected (captions + subtitles always; dub builds in the background). Kept
  // as a distinct verb so callers can express "process this now" intent.
  const processVideo = useCallback(
    (url: string, meta?: Omit<VideoSelection, "url">) => {
      selectVideo(url, meta);
    },
    [selectVideo],
  );

  const cancel = useCallback(() => {
    clearSearch();
    setVideoAction("cancelled");
    setSelectedVideo(null);
  }, [clearSearch]);

  const toggleDub = useCallback(() => {
    // Unlock browser autoplay on the first user gesture, then flip dub mode.
    try {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        void ctx.resume().then(() => ctx.close());
      }
    } catch {
      /* ignore — autoplay unlock is best-effort */
    }
    setDubMode((m) => (m === "mongolian" ? "original" : "mongolian"));
  }, []);

  const toggleGender = useCallback(
    () => setVoiceGender((g) => (g === "male" ? "female" : "male")),
    [],
  );

  const selectVoice = useCallback((id: string) => setSelectedVoiceId(id), []);

  // Keep the state machine in sync with the pipeline: while it's fetching /
  // translating / dubbing the selected video, we're "processing"; when it settles
  // (ready or idle) and we weren't mid-search, clear the action.
  useEffect(() => {
    if (!videoId) return;
    if (
      processStage === "fetching" ||
      processStage === "translating" ||
      processStage === "dubbing"
    ) {
      setVideoAction("processing");
    } else if (processStage === "ready" || processStage === "idle") {
      setVideoAction((a) => (a === "processing" || a === "selecting" ? null : a));
    }
  }, [processStage, videoId]);

  const value: VideoProcessContextType = {
    videoAction,
    setVideoAction,
    selectedVideo,
    videoId,
    searchVideo,
    selectVideo,
    processVideo,
    cancel,
    searchResults,
    isSearching,
    searchError,
    clearSearch,
    player,
    processedSegments,
    translatedSegments: dub.translatedSegments,
    subtitleSegments,
    sourceLang,
    processStage,
    processProgress,
    dubMode,
    toggleDub,
    voiceGender,
    toggleGender,
    voices: VOICES,
    selectedVoiceId,
    selectVoice,
    dub,
  };

  return (
    <VideoProcessContext.Provider value={value}>
      {children}
    </VideoProcessContext.Provider>
  );
};

export const useVideoProcess = (): VideoProcessContextType => {
  const context = useContext(VideoProcessContext);
  if (!context) {
    throw new Error(
      "useVideoProcess must be used within a VideoProcessProvider",
    );
  }
  return context;
};

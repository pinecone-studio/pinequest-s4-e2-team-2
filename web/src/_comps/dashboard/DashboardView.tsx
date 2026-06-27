"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AmbientBackground } from "@/_comps/dashboard/AmbientBackground";
import {
  buildScholarReply,
  FALLBACK_DURATION,
  type HistoryItem,
  type Note,
} from "@/_comps/dashboard/data";
import {
  CollapsedHistoryRail,
  HistoryRail,
} from "@/_comps/dashboard/HistoryRail";
import { NotesPane } from "@/_comps/dashboard/NotesPane";
import { RecommendedVideos } from "@/_comps/dashboard/RecommendedVideos";
import { ScholarOverlay } from "@/_comps/dashboard/ScholarOverlay";
import { DashboardHeader } from "@/_comps/dashboard/DashboardHeader";
import { useYouTubePlayer } from "@/_comps/dashboard/useYouTubePlayer";
import { VideoPane } from "@/_comps/dashboard/VideoPane";
import { SubtitlePane } from "@/_comps/dashboard/SubtitlePane";
import SearchResults from "@/_comps/youtube-search/SearchResults";
import { fetchYouTubeResults } from "@/_comps/youtube-search/api";
import {
  getYouTubeVideoId,
  isPodcastLikeItem,
  isShortLikeVideo,
  isVideoResult,
} from "@/_comps/youtube-search/utils";
import {
  createVideoNote,
  fetchVideoNotes,
  fetchWatchHistory,
  recordWatchHistory,
  type NoteRecord,
  type VideoHistoryPayload,
  type VideoHistoryRecord,
} from "@/lib/backend-api";
import type {
  YouTubeSearchResult,
  YouTubeVideoSearchResult,
} from "@/lib/youtube-search";
import { useProcessedVideo } from "./useProcessedVideo";
import { base64ToBlobUrl } from "@/lib/process-stream";
import { toast } from "@/_comps/ui/Sonner";

export type DashboardVideoSelection = {
  url: string;
  title?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
};

type DashboardViewProps = {
  videoUrl: string;
  selectedVideo?: DashboardVideoSelection | null;
  onBack: () => void;
  onSearch?: (url: string, video?: DashboardVideoSelection) => void;
  onLogout?: () => void;
};

// ── Mappers: backend records → view models used by this screen ──────────────

// Backend note record → UI note (ms timestamp → whole seconds).
function toNote(record: NoteRecord): Note {
  return {
    id: record.id,
    time: Math.floor(record.timestamp_ms / 1000),
    text: record.content,
  };
}

// Backend watch-history record → UI history item (computes watched progress 0–1).
function toHistoryItem(record: VideoHistoryRecord): HistoryItem {
  const durationSeconds = record.duration_seconds;
  const watchedPositionSeconds = Math.floor(record.last_position_ms / 1000);
  const progress = record.completed
    ? 1
    : durationSeconds
      ? Math.min(Math.max(watchedPositionSeconds / durationSeconds, 0), 1)
      : 0;

  return {
    id: record.video_id,
    title: record.title || "YouTube video",
    speaker: record.channel_name || "",
    progress,
    notes: record.notes_count ?? 0,
    thumbnailUrl: record.thumbnail_url || undefined,
    durationSeconds: durationSeconds ?? undefined,
    lastPositionMs: record.last_position_ms,
  };
}

// "1:02:03" duration label → total seconds.
function parseDurationSeconds(value: string) {
  const parts = value
    .split(":")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 0) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// YouTube search result → the lightweight selection this screen passes around.
function selectionFromResult(
  item: YouTubeVideoSearchResult,
): DashboardVideoSelection {
  return {
    url: item.url,
    title: item.title,
    channelTitle: item.channelTitle,
    thumbnailUrl: item.thumbnailUrl,
    durationSeconds: parseDurationSeconds(item.durationLabel),
  };
}

// Placeholder history item for a just-selected video not yet in saved history.
function historyItemFromSelection(
  videoId: string,
  selection?: DashboardVideoSelection | null,
): HistoryItem {
  return {
    id: videoId,
    title: selection?.title || "YouTube video",
    speaker: selection?.channelTitle || "",
    progress: 0,
    notes: 0,
    thumbnailUrl: selection?.thumbnailUrl,
    durationSeconds: selection?.durationSeconds,
  };
}

// Builds the POST body for saving watch progress (current time → ms, completed flag).
function historyPayload(
  videoId: string,
  videoUrl: string,
  selection: DashboardVideoSelection | null | undefined,
  time: number,
  duration: number,
): VideoHistoryPayload {
  return {
    video_id: videoId,
    last_position_ms: Math.floor(time * 1000),
    watched_seconds: Math.floor(time),
    completed: duration > 0 ? time / duration >= 0.95 : false,
    youtube_url:
      selection?.url ||
      videoUrl ||
      `https://www.youtube.com/watch?v=${videoId}`,
    title: selection?.title,
    channel_name: selection?.channelTitle,
    thumbnail_url: selection?.thumbnailUrl,
    duration_seconds:
      selection?.durationSeconds ||
      (duration > 0 ? Math.floor(duration) : undefined),
  };
}

// Derives a search query (title + speaker) used to fetch "recommended" videos.
function recommendationQuery(item: HistoryItem | null) {
  if (!item) return "";

  const title = item.title === "YouTube video" ? "" : item.title;
  return [title, item.speaker].filter(Boolean).join(" ").slice(0, 110);
}

// Main watch screen: YouTube player + live captions, plus notes, watch history,
// search and recommendations. Composed of smaller panes (VideoPane, NotesPane,
// HistoryRail, SubtitlePane); this component owns the shared state and handlers.
export default function DashboardView({
  videoUrl,
  selectedVideo,
  onBack,
  onSearch,
  onLogout,
}: DashboardViewProps) {
  // The 11-char id parsed from the incoming URL — drives captions, notes, history.
  const videoId = useMemo(() => getYouTubeVideoId(videoUrl) ?? "", [videoUrl]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"write" | "review">("write");
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [searchError, setSearchError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [recommendedVideos, setRecommendedVideos] = useState<
    YouTubeVideoSearchResult[]
  >([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState("");
  const playbackRef = useRef({ time: 0, duration: 0 });
  const lastAudioStartRef = useRef<number>(-1);

  // Fetch the user's saved watch history from the backend.
  const reloadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const records = await fetchWatchHistory();
      setHistoryItems(records.map(toHistoryItem));
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : "History failed to load.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Insert/replace one history record and move it to the top of the rail.
  const upsertHistoryRecord = useCallback((record: VideoHistoryRecord) => {
    const item = toHistoryItem(record);
    setHistoryItems((previous) => {
      const existing = previous.find((entry) => entry.id === item.id);
      const nextItem = existing
        ? { ...item, notes: Math.max(item.notes, existing.notes) }
        : item;
      return [nextItem, ...previous.filter((entry) => entry.id !== item.id)];
    });
  }, []);

  // Load watch history once on mount.
  useEffect(() => {
    void Promise.resolve().then(reloadHistory);
  }, [reloadHistory]);

  // Load this video's notes whenever the selected video changes.
  useEffect(() => {
    if (!videoId) {
      queueMicrotask(() => setNotes([]));
      return;
    }

    let active = true;
    const load = async () => {
      try {
        const records = await fetchVideoNotes(videoId);
        if (active) setNotes(records.map(toNote));
      } catch (error) {
        console.warn("Notes failed to load:", error);
        if (active) setNotes([]);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [videoId]);

  // Resolve the "active" video metadata: prefer the saved history record, else a
  // placeholder from the current selection so the UI has a title/duration to show.
  const currentHistoryItem = historyItems.find((item) => item.id === videoId);
  const fallbackItem = videoId
    ? historyItemFromSelection(videoId, selectedVideo)
    : null;
  const activeItem = currentHistoryItem ?? fallbackItem;
  const visibleHistoryItems = useMemo(() => {
    if (
      !fallbackItem ||
      historyItems.some((item) => item.id === fallbackItem.id)
    ) {
      return historyItems;
    }
    return [fallbackItem, ...historyItems];
  }, [fallbackItem, historyItems]);
  const segmentDuration = activeItem?.durationSeconds ?? FALLBACK_DURATION;
  const player = useYouTubePlayer(videoId, segmentDuration);
  // Fetches captions for the selected video (Path A, client-side) and exposes
  // them as `processedSegments` for the SubtitlePane to render.
  const {
    segments: processedSegments,
    loading: processingLoading,
    error: processingError,
  } = useProcessedVideo(videoId);
  const reply = useMemo(() => buildScholarReply(notes), [notes]);
  const recommendationSearchQuery = useMemo(
    () => recommendationQuery(activeItem),
    [activeItem],
  );
  const searchCounts = useMemo(
    () => ({
      videos: searchResults.filter((item) => item.kind === "video").length,
      live: searchResults.filter((item) => item.kind === "live").length,
      channels: searchResults.filter((item) => item.kind === "channel").length,
      playlists: searchResults.filter((item) => item.kind === "playlist")
        .length,
      shorts: searchResults.filter(isShortLikeVideo).length,
      podcasts: searchResults.filter(isPodcastLikeItem).length,
    }),
    [searchResults],
  );
  const layoutClassName = useMemo(
    () =>
      [
        "dashboard-layout",
        historyCollapsed ? "history-is-collapsed" : "",
        notesCollapsed ? "notes-is-collapsed" : "",
      ]
        .filter(Boolean)
        .join(" "),
    [historyCollapsed, notesCollapsed],
  );
  const visibleRecommendedVideos = recommendationSearchQuery
    ? recommendedVideos
    : [];
  const visibleRecommendationsLoading =
    Boolean(recommendationSearchQuery) && recommendationsLoading;
  const visibleRecommendationsError = recommendationSearchQuery
    ? recommendationsError
    : "";

  useEffect(() => {
    playbackRef.current = { time: player.time, duration: player.duration };
  }, [player.duration, player.time]);

  // Play dubbed audio for the active segment, synced to player.time.
  useEffect(() => {
    if (!player.playing) return;
    const seg = processedSegments.find(
      (s) => s.audio_b64 && player.time >= s.start && player.time < s.start + s.duration,
    );
    if (!seg?.audio_b64 || seg.start === lastAudioStartRef.current) return;
    lastAudioStartRef.current = seg.start;
    const url = base64ToBlobUrl(seg.audio_b64);
    const clip = new Audio(url);
    clip.play().catch(() => {});
    clip.onended = () => URL.revokeObjectURL(url);
  }, [player.time, player.playing, processedSegments]);

  // Log the caption-fetch lifecycle for the selected video.
  useEffect(() => {
    if (processingError) {
      console.warn("caption fetch failed:", processingError);
    } else if (!processingLoading && processedSegments.length) {
      console.log(`captions loaded: ${processedSegments.length} segments for ${videoId}`);
    }
  }, [processedSegments, processingLoading, processingError, videoId]);

  // Persist the current playback position to watch history (called on a timer,
  // on unmount, and after adding a note).
  const savePlayback = useCallback(async () => {
    if (!videoId) return;
    const { time, duration } = playbackRef.current;
    try {
      const record = await recordWatchHistory(
        historyPayload(videoId, videoUrl, selectedVideo, time, duration),
      );
      if (selectedVideo) {
        console.log(selectedVideo.title);
      }
      upsertHistoryRecord(record);
    } catch (error) {
      console.warn("Watch history failed to save:", error);
    }
  }, [selectedVideo, upsertHistoryRecord, videoId, videoUrl]);

  // Bump the note badge count on the matching history item (optimistic update).
  const incrementHistoryNoteCount = useCallback(
    (savedVideoId: string) => {
      setHistoryLoading(false);
      setHistoryError("");
      setHistoryItems((previous) => {
        let found = false;
        const next = previous.map((item) => {
          if (item.id !== savedVideoId) return item;
          found = true;
          return { ...item, notes: item.notes + 1 };
        });

        if (found || !activeItem) return next;
        return [{ ...activeItem, notes: activeItem.notes + 1 }, ...next];
      });
    },
    [activeItem],
  );

  // Save playback now, then every 15s, and once more on cleanup.
  useEffect(() => {
    if (!videoId) return;
    void savePlayback();
    const intervalId = window.setInterval(() => {
      void savePlayback();
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
      void savePlayback();
    };
  }, [savePlayback, videoId]);

  // Create a note at the current playback time and update local state/history.
  async function addNote() {
    const text = draft.trim();
    if (!text) return;

    if (!videoId) {
      toast("Эхлээд видео сонгоно уу");
      return;
    }
    // Видео тоглож эхлээгүй бол тэмдэглэлийн цаг утгагүй — хэрэглэгчид сануулна.
    if (!player.ready || (!player.playing && player.time < 1)) {
      toast("Видеогоо тоглуулаад тэмдэглэлээ хийгээрэй");
      return;
    }

    try {
      const record = await createVideoNote(
        videoId,
        Math.floor(player.time * 1000),
        text,
      );
      const note = toNote(record);
      setNotes((previous) => [...previous, note]);
      setDraft("");
      setJustAdded(note.id);
      incrementHistoryNoteCount(videoId);
      void savePlayback();
    } catch (error) {
      console.warn("Note failed to save:", error);
      toast.error("Тэмдэглэл хадгалахад алдаа гарлаа");
    }
  }

  // Switch to a video picked from the history rail.
  function selectHistory(item: HistoryItem) {
    setSummaryOpen(false);
    setSearchResults([]);
    setSearchError("");
    if (item.id === videoId) return;
    console.log(`selected video ${item.id}`);
    onSearch?.(`https://www.youtube.com/watch?v=${item.id}`, {
      url: `https://www.youtube.com/watch?v=${item.id}`,
      title: item.title,
      channelTitle: item.speaker,
      thumbnailUrl: item.thumbnailUrl,
      durationSeconds: item.durationSeconds,
    });
  }

  // Switch to a video picked from the search results panel.
  function selectSearchResult(item: YouTubeSearchResult) {
    if (!isVideoResult(item)) return;
    const selection = selectionFromResult(item);
    setSearchResults([]);
    setSearchError("");
    setSearchedQuery("");
    setQuery("");
    console.log(`selected video ${getYouTubeVideoId(selection.url) ?? ""}`);
    onSearch?.(selection.url, selection);
  }

  // Switch to a video picked from the recommendations rail.
  function selectRecommendedVideo(item: YouTubeVideoSearchResult) {
    if (item.videoId === videoId) return;
    const selection = selectionFromResult(item);
    setSearchResults([]);
    setSearchError("");
    setSearchedQuery("");
    console.log(`selected video ${item.videoId}`);
    onSearch?.(selection.url, selection);
  }

  useEffect(() => {
    if (!notesCollapsed || !recommendationSearchQuery) {
      return;
    }

    // Fetch recommendations (only when the notes pane is collapsed to make room).
    let active = true;
    const controller = new AbortController();

    const loadRecommendations = async () => {
      setRecommendationsLoading(true);
      setRecommendationsError("");

      try {
        const results = await fetchYouTubeResults(recommendationSearchQuery, {
          type: "video",
          pages: 2,
          signal: controller.signal,
        });
        if (!active) return;

        const unique = new Map<string, YouTubeVideoSearchResult>();
        results.forEach((item) => {
          if (
            !isVideoResult(item) ||
            item.videoId === videoId ||
            unique.has(item.videoId)
          ) {
            return;
          }
          unique.set(item.videoId, item);
        });

        setRecommendedVideos(Array.from(unique.values()).slice(0, 8));
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setRecommendedVideos([]);
        setRecommendationsError(
          error instanceof Error
            ? error.message
            : "YouTube recommendations failed.",
        );
      } finally {
        if (active) setRecommendationsLoading(false);
      }
    };

    void loadRecommendations();

    return () => {
      active = false;
      controller.abort();
    };
  }, [notesCollapsed, recommendationSearchQuery, videoId]);

  // Handle the header search box: a pasted URL jumps straight to that video,
  // otherwise run a YouTube search and show the results panel.
  async function submitSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;

    const directId = getYouTubeVideoId(trimmed);
    if (directId) {
      const url = `https://www.youtube.com/watch?v=${directId}`;
      setSearchResults([]);
      setSearchError("");
      setSearchedQuery("");
      console.log(`selected video ${directId}`);
      onSearch?.(url, { url });
      return;
    }

    if (trimmed.length < 2) {
      setSearchError("Search query must be at least 2 characters.");
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setSearchError("");
    setSearchedQuery(trimmed);

    try {
      const results = await fetchYouTubeResults(trimmed, { type: "video" });
      setSearchResults(results);
      if (results.length === 0) {
        setSearchError("No videos found. Try another query.");
      }
    } catch (error) {
      setSearchResults([]);
      setSearchError(
        error instanceof Error ? error.message : "YouTube search failed.",
      );
    } finally {
      setIsSearching(false);
    }
  }

  // Layout: header + optional search panel on top; below, a 3-column row of
  // history rail | video+subtitles | notes (or recommendations when collapsed).
  return (
    <div className="dashboard-app-shell">
      <AmbientBackground />
      <DashboardHeader
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          if (searchError) setSearchError("");
        }}
        onSubmit={submitSearch}
        onBack={onBack}
        onLogout={onLogout}
      />
      {(isSearching || searchError || searchResults.length > 0) && (
        <div className="dashboard-search-results-panel">
          {isSearching && (
            <div className="dashboard-search-status">Searching YouTube...</div>
          )}
          {!isSearching && searchError && (
            <div className="dashboard-search-status">{searchError}</div>
          )}
          {!isSearching && searchResults.length > 0 && (
            <SearchResults
              query={searchedQuery}
              results={searchResults}
              counts={searchCounts}
              onSelect={selectSearchResult}
            />
          )}
        </div>
      )}
      <div className={layoutClassName}>
        {historyCollapsed ? (
          <CollapsedHistoryRail onOpen={() => setHistoryCollapsed(false)} />
        ) : (
          <HistoryRail
            items={visibleHistoryItems}
            activeId={videoId}
            loading={historyLoading}
            error={historyError}
            onSelect={selectHistory}
            onCollapse={() => setHistoryCollapsed(true)}
          />
        )}
        <VideoPane
          containerRef={player.containerRef}
          ready={player.ready}
          notes={notes}
          hasVideo={Boolean(videoId)}
          title={activeItem?.title ?? "Choose a YouTube video"}
          speaker={activeItem?.speaker ?? ""}
          sourceLine={!videoId ? "NO VIDEO SELECTED" : undefined}
          subtitle={
            videoId ? (
              <SubtitlePane
                segments={processedSegments}
                currentTime={player.time}
                loading={processingLoading}
                error={processingError}
              />
            ) : null
          }
        />
        {notesCollapsed ? (
          <RecommendedVideos
            items={visibleRecommendedVideos}
            loading={visibleRecommendationsLoading}
            error={visibleRecommendationsError}
            onSelect={selectRecommendedVideo}
            onOpenNotes={() => setNotesCollapsed(false)}
          />
        ) : (
          <NotesPane
            notes={notes}
            draft={draft}
            mode={mode}
            justAdded={justAdded}
            onDraftChange={setDraft}
            onAddNote={addNote}
            onSetMode={setMode}
            onJump={player.seek}
            onOpenSummary={() => setSummaryOpen(true)}
            onCollapse={() => setNotesCollapsed(true)}
          />
        )}
      </div>
      <ScholarOverlay
        open={summaryOpen}
        reply={reply}
        onClose={() => setSummaryOpen(false)}
      />
    </div>
  );
}

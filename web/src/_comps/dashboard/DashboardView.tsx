"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AmbientBackground } from "@/_comps/dashboard/AmbientBackground";
import {
  buildScholarReply,
  FALLBACK_DURATION,
  type HistoryItem,
  type Note,
} from "@/_comps/dashboard/data";
import { CollapsedHistoryRail, HistoryRail } from "@/_comps/dashboard/HistoryRail";
import { NotesPane } from "@/_comps/dashboard/NotesPane";
import { RecommendedVideos } from "@/_comps/dashboard/RecommendedVideos";
import { ScholarOverlay } from "@/_comps/dashboard/ScholarOverlay";
import { DashboardHeader } from "@/_comps/dashboard/DashboardHeader";
import { useYouTubePlayer } from "@/_comps/dashboard/useYouTubePlayer";
import { VideoPane } from "@/_comps/dashboard/VideoPane";
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
import type { YouTubeSearchResult, YouTubeVideoSearchResult } from "@/lib/youtube-search";

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

function toNote(record: NoteRecord): Note {
  return {
    id: record.id,
    time: Math.floor(record.timestamp_ms / 1000),
    text: record.content,
  };
}

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

function parseDurationSeconds(value: string) {
  const parts = value
    .split(":")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 0) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function selectionFromResult(item: YouTubeVideoSearchResult): DashboardVideoSelection {
  return {
    url: item.url,
    title: item.title,
    channelTitle: item.channelTitle,
    thumbnailUrl: item.thumbnailUrl,
    durationSeconds: parseDurationSeconds(item.durationLabel),
  };
}

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
    youtube_url: selection?.url || videoUrl || `https://www.youtube.com/watch?v=${videoId}`,
    title: selection?.title,
    channel_name: selection?.channelTitle,
    thumbnail_url: selection?.thumbnailUrl,
    duration_seconds: selection?.durationSeconds || (duration > 0 ? Math.floor(duration) : undefined),
  };
}

function recommendationQuery(item: HistoryItem | null) {
  if (!item) return "";

  const title = item.title === "YouTube video" ? "" : item.title;
  return [title, item.speaker].filter(Boolean).join(" ").slice(0, 110);
}

export default function DashboardView({
  videoUrl,
  selectedVideo,
  onBack,
  onSearch,
  onLogout,
}: DashboardViewProps) {
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
  const [recommendedVideos, setRecommendedVideos] = useState<YouTubeVideoSearchResult[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState("");
  const playbackRef = useRef({ time: 0, duration: 0 });

  const reloadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const records = await fetchWatchHistory();
      setHistoryItems(records.map(toHistoryItem));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "History failed to load.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const upsertHistoryRecord = useCallback((record: VideoHistoryRecord) => {
    const item = toHistoryItem(record);
    setHistoryItems((previous) => {
      const existing = previous.find((entry) => entry.id === item.id);
      const nextItem = existing ? { ...item, notes: Math.max(item.notes, existing.notes) } : item;
      return [nextItem, ...previous.filter((entry) => entry.id !== item.id)];
    });
  }, []);

  useEffect(() => {
    void Promise.resolve().then(reloadHistory);
  }, [reloadHistory]);

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

  const currentHistoryItem = historyItems.find((item) => item.id === videoId);
  const fallbackItem = videoId ? historyItemFromSelection(videoId, selectedVideo) : null;
  const activeItem = currentHistoryItem ?? fallbackItem;
  const visibleHistoryItems = useMemo(() => {
    if (!fallbackItem || historyItems.some((item) => item.id === fallbackItem.id)) {
      return historyItems;
    }
    return [fallbackItem, ...historyItems];
  }, [fallbackItem, historyItems]);
  const segmentDuration = activeItem?.durationSeconds ?? FALLBACK_DURATION;
  const player = useYouTubePlayer(videoId, segmentDuration);
  const reply = useMemo(() => buildScholarReply(notes), [notes]);
  const recommendationSearchQuery = useMemo(() => recommendationQuery(activeItem), [activeItem]);
  const searchCounts = useMemo(
    () => ({
      videos: searchResults.filter((item) => item.kind === "video").length,
      live: searchResults.filter((item) => item.kind === "live").length,
      channels: searchResults.filter((item) => item.kind === "channel").length,
      playlists: searchResults.filter((item) => item.kind === "playlist").length,
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
  const visibleRecommendedVideos = recommendationSearchQuery ? recommendedVideos : [];
  const visibleRecommendationsLoading = Boolean(recommendationSearchQuery) && recommendationsLoading;
  const visibleRecommendationsError = recommendationSearchQuery ? recommendationsError : "";

  useEffect(() => {
    playbackRef.current = { time: player.time, duration: player.duration };
  }, [player.duration, player.time]);

  const savePlayback = useCallback(async () => {
    if (!videoId) return;
    const { time, duration } = playbackRef.current;
    try {
      const record = await recordWatchHistory(
        historyPayload(videoId, videoUrl, selectedVideo, time, duration),
      );
      upsertHistoryRecord(record);
    } catch (error) {
      console.warn("Watch history failed to save:", error);
    }
  }, [selectedVideo, upsertHistoryRecord, videoId, videoUrl]);

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

  async function addNote() {
    if (!videoId) return;
    const text = draft.trim();
    if (!text) return;

    try {
      const record = await createVideoNote(videoId, Math.floor(player.time * 1000), text);
      const note = toNote(record);
      setNotes((previous) => [...previous, note]);
      setDraft("");
      setJustAdded(note.id);
      incrementHistoryNoteCount(videoId);
      void savePlayback();
    } catch (error) {
      console.warn("Note failed to save:", error);
    }
  }

  function selectHistory(item: HistoryItem) {
    setSummaryOpen(false);
    setSearchResults([]);
    setSearchError("");
    if (item.id === videoId) return;
    onSearch?.(`https://www.youtube.com/watch?v=${item.id}`, {
      url: `https://www.youtube.com/watch?v=${item.id}`,
      title: item.title,
      channelTitle: item.speaker,
      thumbnailUrl: item.thumbnailUrl,
      durationSeconds: item.durationSeconds,
    });
  }

  function selectSearchResult(item: YouTubeSearchResult) {
    if (!isVideoResult(item)) return;
    const selection = selectionFromResult(item);
    setSearchResults([]);
    setSearchError("");
    setSearchedQuery("");
    setQuery("");
    onSearch?.(selection.url, selection);
  }

  function selectRecommendedVideo(item: YouTubeVideoSearchResult) {
    if (item.videoId === videoId) return;
    const selection = selectionFromResult(item);
    setSearchResults([]);
    setSearchError("");
    setSearchedQuery("");
    onSearch?.(selection.url, selection);
  }

  useEffect(() => {
    if (!notesCollapsed || !recommendationSearchQuery) {
      return;
    }

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
          if (!isVideoResult(item) || item.videoId === videoId || unique.has(item.videoId)) {
            return;
          }
          unique.set(item.videoId, item);
        });

        setRecommendedVideos(Array.from(unique.values()).slice(0, 8));
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setRecommendedVideos([]);
        setRecommendationsError(
          error instanceof Error ? error.message : "YouTube recommendations failed.",
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

  async function submitSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;

    const directId = getYouTubeVideoId(trimmed);
    if (directId) {
      const url = `https://www.youtube.com/watch?v=${directId}`;
      setSearchResults([]);
      setSearchError("");
      setSearchedQuery("");
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
      setSearchError(error instanceof Error ? error.message : "YouTube search failed.");
    } finally {
      setIsSearching(false);
    }
  }

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
          {isSearching && <div className="dashboard-search-status">Searching YouTube...</div>}
          {!isSearching && searchError && <div className="dashboard-search-status">{searchError}</div>}
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
            currentTime={player.time}
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
      <ScholarOverlay open={summaryOpen} reply={reply} onClose={() => setSummaryOpen(false)} />
    </div>
  );
}

"use client";

// UIProvider = the user's DATA layer, USER INTERFACE. Everything that fetches per-user data —
// watch history, YouTube recommendations, and notes — lives here so components
// (the sidebar) just read state and call load*() instead of each owning 800
// lines of fetching logic.
//
// Access tiers:
//   - regular users  → history + recommendations
//   - allowAccess    → also notes + AI (the sidebar decides what to render;
//                      the data is always available here)
//
// NOTE: this provider sits ABOVE VideoProcessProvider in the tree, so it can't
// read the selected video itself. Callers pass the query/videoId into load*().

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/_comps/providers/AuthProvider";
import {
  createVideoNote,
  fetchVideoNotes,
  fetchWatchHistory,
  type NoteRecord,
  type VideoHistoryRecord,
} from "@/lib/backend-api";
import { fetchYouTubeResults } from "@/_comps/youtube-search/api";
import { isVideoResult } from "@/_comps/youtube-search/utils";
import type { HistoryItem, Note } from "@/_comps/dashboard/data";
import type { YouTubeVideoSearchResult } from "@/lib/youtube-search";


// ── Backend record → view model mappers ─────────────────────────────────────
function toHistoryItem(record: VideoHistoryRecord): HistoryItem {
  const durationSeconds = record.duration_seconds;
  const watched = Math.floor(record.last_position_ms / 1000);
  const progress = record.completed
    ? 1
    : durationSeconds
      ? Math.min(Math.max(watched / durationSeconds, 0), 1)
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

function toNote(record: NoteRecord): Note {
  return {
    id: record.id,
    time: Math.floor(record.timestamp_ms / 1000),
    text: record.content,
  };
}

interface UIContextType {
  isSubscribed: boolean;
  allowAccess: boolean;
  setAllowAccess: (allow: boolean) => void;
  history: HistoryItem[];
  historyLoading: boolean;
  historyError: string;
  loadHistory: () => void;
  recommendations: YouTubeVideoSearchResult[];
  recommendationsLoading: boolean;
  recommendationsError: string;
  loadRecommendations: (query: string, excludeVideoId?: string) => void;
  notes: Note[];
  notesLoading: boolean;
  loadNotes: (videoId: string) => void;
  addNote: (videoId: string, timeMs: number, text: string) => Promise<Note>;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider = ({ children }: { children: ReactNode }) => {
  const { user, paid } = useAuth();
  const [allowAccess, setAllowAccess] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  // Only reached for LOGGED-OUT users clicking a result → prompt sign-in.
  // Signed-in selection is handled inside SearchBox via the provider.

  const [recommendations, setRecommendations] = useState<
    YouTubeVideoSearchResult[]
  >([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState("");
  const recAbortRef = useRef<AbortController | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);

  const isSubscribed = Boolean(user && paid);

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    setHistoryError("");
    fetchWatchHistory()
      .then((records) => setHistory(records.map(toHistoryItem)))
      .catch((err) => {
        setHistory([]);
        setHistoryError(
          err instanceof Error ? err.message : "History failed to load.",
        );
      })
      .finally(() => setHistoryLoading(false));
  }, []);

  const loadRecommendations = useCallback(
    (query: string, excludeVideoId?: string) => {
      recAbortRef.current?.abort();

      const trimmed = query.trim();
      if (!trimmed) {
        setRecommendations([]);
        setRecommendationsError("");
        setRecommendationsLoading(false);
        return;
      }

      const controller = new AbortController();
      recAbortRef.current = controller;
      setRecommendationsLoading(true);
      setRecommendationsError("");

      fetchYouTubeResults(trimmed, {
        type: "video",
        pages: 2,
        signal: controller.signal,
      })
        .then((results) => {
          if (controller.signal.aborted) return;
          const unique = new Map<string, YouTubeVideoSearchResult>();
          results.forEach((item) => {
            if (
              isVideoResult(item) &&
              item.videoId !== excludeVideoId &&
              !unique.has(item.videoId)
            ) {
              unique.set(item.videoId, item);
            }
          });
          setRecommendations(Array.from(unique.values()).slice(0, 10));
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setRecommendations([]);
          setRecommendationsError(
            err instanceof Error ? err.message : "Recommendations failed.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setRecommendationsLoading(false);
        });
    },
    [],
  );

  const loadNotes = useCallback((videoId: string) => {
    if (!videoId) {
      setNotes([]);
      return;
    }
    setNotesLoading(true);
    fetchVideoNotes(videoId)
      .then((records) => setNotes(records.map(toNote)))
      .catch(() => setNotes([]))
      .finally(() => setNotesLoading(false));
  }, []);

  const addNote = useCallback(
    async (videoId: string, timeMs: number, text: string) => {
      const note = toNote(await createVideoNote(videoId, timeMs, text));
      setNotes((prev) => [...prev, note]);
      return note;
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (user) loadHistory();
      else setHistory([]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [user, loadHistory]);

  return (
    <UIContext.Provider
      value={{
        isSubscribed,
        allowAccess,
        setAllowAccess,
        history,
        historyLoading,
        historyError,
        loadHistory,
        recommendations,
        recommendationsLoading,
        recommendationsError,
        loadRecommendations,
        notes,
        notesLoading,
        loadNotes,
        addNote,
      }}
    >
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error("useUI must be used within a UIProvider");
  }
  return context;
};

"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  HelpCircle,
  History,
  NotebookPen,
  PanelRightClose,
  PlayCircle,
  Search,
  Send,
  Sparkles,
  TextSearch,
  type LucideIcon,
} from "lucide-react";
import {
  chatWithAssistant,
  fetchCachedVideoTranscript,
  saveCachedVideoTranscript,
  type AssistantMode,
  type AssistantSegmentPayload,
  type Segment,
} from "@/lib/backend-api";
import { fetchTranscript } from "@/lib/process-stream";
import { type HistoryItem } from "./data";

type AssistantChatProps = {
  open: boolean;
  videoId: string;
  currentTime: number;
  segments: Segment[];
  historyItems: HistoryItem[];
  onClose: () => void;
  onCollapse: () => void;
  onSelectHistory: (item: HistoryItem) => void;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

type TranscriptSearchSegment = {
  start: number;
  duration: number;
  text: string;
};

type TranscriptCacheEntry =
  | { status: "loading" }
  | { status: "ready"; segments: TranscriptSearchSegment[] }
  | { status: "error"; error: string };

type HistorySearchMatch = {
  item: HistoryItem;
  score: number;
  source: "metadata" | "transcript";
  snippet?: string;
};

const TRANSCRIPT_SEARCH_LIMIT = 12;
const TRANSCRIPT_SEARCH_CONCURRENCY = 2;
const TRANSCRIPT_QUERY_MIN_LENGTH = 3;

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "about",
  "for",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "video",
  "what",
  "why",
  "with",
  "юм",
  "юу",
  "вэ",
  "нь",
  "энэ",
  "тэр",
  "дээр",
]);

const QUICK_ACTIONS: Array<{
  mode: AssistantMode;
  label: string;
  icon: LucideIcon;
  userText: string;
}> = [
  {
    mode: "help",
    label: "Заавар",
    icon: HelpCircle,
    userText: "Website ашиглах заавар өгөөч.",
  },
  {
    mode: "current_segment",
    label: "Тайлбар",
    icon: TextSearch,
    userText: "Одоо үзэж байгаа хэсгийг тайлбарла.",
  },
  {
    mode: "summary",
    label: "Summary",
    icon: Sparkles,
    userText: "Бичлэгийн нийт summary гарга.",
  },
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTerms(value: string) {
  return normalizeSearch(value)
    .split(" ")
    .filter(
      (term) => term.length > 1 && !SEARCH_STOP_WORDS.has(term),
    );
}

function historySearchText(item: HistoryItem) {
  return normalizeSearch(
    [
      item.title,
      item.speaker,
      item.id,
      `${item.notes} notes`,
      `${item.notes} тэмдэглэл`,
    ].join(" "),
  );
}

function currentVideoSegments(segments: Segment[]): TranscriptSearchSegment[] {
  return segments.map((segment) => ({
    start: segment.start,
    duration: segment.duration,
    text: [segment.text, segment.translated_text].filter(Boolean).join(" "),
  }));
}

function metadataScore(
  item: HistoryItem,
  normalizedQuery: string,
  terms: string[],
) {
  const source = historySearchText(item);
  if (!source) return 0;

  let score = source.includes(normalizedQuery) ? 80 : 0;
  for (const term of terms) {
    if (source.includes(term)) score += 18;
  }
  return terms.length > 0 && terms.every((term) => source.includes(term))
    ? score + 30
    : score;
}

function scoreTranscriptText(
  source: string,
  normalizedQuery: string,
  terms: string[],
) {
  if (!source) return 0;

  let score = source.includes(normalizedQuery) ? 90 : 0;
  for (const term of terms) {
    if (source.includes(term)) {
      score += 24;
    } else if (source.split(" ").some((word) => word.startsWith(term))) {
      score += 12;
    }
  }

  if (terms.length > 0 && terms.every((term) => source.includes(term))) {
    score += 36;
  }
  return score;
}

function trimSnippet(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 190);
}

function findTranscriptMatch(
  segments: TranscriptSearchSegment[],
  normalizedQuery: string,
  terms: string[],
) {
  let best: { score: number; snippet: string } | null = null;

  for (let index = 0; index < segments.length; index += 1) {
    const windowText = segments
      .slice(Math.max(0, index - 1), Math.min(segments.length, index + 3))
      .map((segment) => segment.text)
      .join(" ");
    const normalizedWindow = normalizeSearch(windowText);
    const score = scoreTranscriptText(normalizedWindow, normalizedQuery, terms);

    if (score > 0 && (!best || score > best.score)) {
      best = { score, snippet: trimSnippet(windowText) };
    }
  }

  return best;
}

function formatHistoryProgress(item: HistoryItem) {
  if (item.progress >= 1) return "Watched";
  if (item.progress > 0) return `${Math.round(item.progress * 100)}%`;
  return "New";
}

function segmentTextLength(segment: Segment) {
  return (segment.translated_text || segment.text || "").length;
}

function compactSegments(
  segments: Segment[],
  mode: AssistantMode,
  currentTime: number,
): AssistantSegmentPayload[] {
  const source =
    mode === "current_segment"
      ? segments.filter(
          (segment) =>
            segment.start + segment.duration >= currentTime - 70 &&
            segment.start <= currentTime + 100,
        )
      : segments;
  const fallback = source.length ? source : segments;
  const maxChars = mode === "current_segment" ? 6000 : 18000;
  let used = 0;
  const compacted: AssistantSegmentPayload[] = [];

  for (const segment of fallback) {
    if (!segment.text.trim() && !segment.translated_text?.trim()) continue;
    const length = segmentTextLength(segment);
    if (used + length > maxChars) break;
    used += length;
    compacted.push({
      start: segment.start,
      duration: segment.duration,
      text: segment.text,
      translated_text: segment.translated_text,
    });
  }

  return compacted;
}

export function AssistantChat({
  open,
  videoId,
  currentTime,
  segments,
  historyItems,
  onClose,
  onCollapse,
  onSelectHistory,
}: AssistantChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Сайн байна уу. Юу асуух вэ?",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [transcriptCache, setTranscriptCache] = useState<
    Record<string, TranscriptCacheEntry>
  >({});
  const [loading, setLoading] = useState(false);
  const transcriptCacheRef = useRef<Record<string, TranscriptCacheEntry>>({});

  const hasTranscript = useMemo(() => segments.length > 0, [segments.length]);
  const normalizedHistoryQuery = useMemo(
    () => normalizeSearch(historyQuery),
    [historyQuery],
  );
  const historyQueryTerms = useMemo(
    () => searchTerms(historyQuery),
    [historyQuery],
  );
  const transcriptSearchCandidates = useMemo(
    () => historyItems.slice(0, TRANSCRIPT_SEARCH_LIMIT),
    [historyItems],
  );
  const historyMatches = useMemo<HistorySearchMatch[]>(() => {
    if (normalizedHistoryQuery.length < 2) return [];

    const matches = new Map<string, HistorySearchMatch>();
    for (const item of historyItems) {
      const score = metadataScore(
        item,
        normalizedHistoryQuery,
        historyQueryTerms,
      );
      if (score > 0) {
        matches.set(item.id, {
          item,
          score,
          source: "metadata",
        });
      }
    }

    if (normalizedHistoryQuery.length >= TRANSCRIPT_QUERY_MIN_LENGTH) {
      for (const item of transcriptSearchCandidates) {
        const entry = transcriptCache[item.id];
        if (entry?.status !== "ready") continue;

        const transcriptMatch = findTranscriptMatch(
          entry.segments,
          normalizedHistoryQuery,
          historyQueryTerms,
        );
        if (!transcriptMatch) continue;

        const existing = matches.get(item.id);
        const nextMatch: HistorySearchMatch = {
          item,
          score: transcriptMatch.score + (existing?.score ?? 0),
          source: "transcript",
          snippet: transcriptMatch.snippet,
        };
        matches.set(item.id, nextMatch);
      }
    }

    return Array.from(matches.values())
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
  }, [
    historyItems,
    historyQueryTerms,
    normalizedHistoryQuery,
    transcriptCache,
    transcriptSearchCandidates,
  ]);
  const transcriptLoadingCount = transcriptSearchCandidates.filter(
    (item) => transcriptCache[item.id]?.status === "loading",
  ).length;
  const transcriptReadyCount = transcriptSearchCandidates.filter(
    (item) => transcriptCache[item.id]?.status === "ready",
  ).length;
  const transcriptSearchEnabled =
    normalizedHistoryQuery.length >= TRANSCRIPT_QUERY_MIN_LENGTH;
  const showHistorySearch = historyQuery.trim().length >= 2;

  useEffect(() => {
    transcriptCacheRef.current = transcriptCache;
  }, [transcriptCache]);

  useEffect(() => {
    if (!videoId || segments.length === 0) return;

    const currentSegments = currentVideoSegments(segments);
    const nextCache = {
      ...transcriptCacheRef.current,
      [videoId]: {
        status: "ready" as const,
        segments: currentSegments,
      },
    };
    transcriptCacheRef.current = nextCache;
    queueMicrotask(() => {
      setTranscriptCache((current) => {
        const next = {
          ...current,
          [videoId]: {
            status: "ready" as const,
            segments: currentSegments,
          },
        };
        transcriptCacheRef.current = next;
        return next;
      });
    });
  }, [segments, videoId]);

  useEffect(() => {
    if (!open || !transcriptSearchEnabled) return;

    const toLoad = transcriptSearchCandidates.filter(
      (item) => !transcriptCacheRef.current[item.id],
    );
    if (toLoad.length === 0) return;

    let cancelled = false;
    const controllers = new Set<AbortController>();
    const nextCache = { ...transcriptCacheRef.current };
    for (const item of toLoad) {
      nextCache[item.id] = { status: "loading" };
    }
    transcriptCacheRef.current = nextCache;
    queueMicrotask(() => {
      if (cancelled) return;
      setTranscriptCache((current) => {
        const next = { ...current };
        for (const item of toLoad) {
          if (!next[item.id]) next[item.id] = { status: "loading" };
        }
        transcriptCacheRef.current = next;
        return next;
      });
    });

    const commitTranscriptCache = (
      videoKey: string,
      entry: TranscriptCacheEntry,
    ) => {
      if (cancelled) return;
      setTranscriptCache((current) => {
        const next = { ...current, [videoKey]: entry };
        transcriptCacheRef.current = next;
        return next;
      });
    };

    const queue = [...toLoad];
    const loadNext = async () => {
      while (!cancelled && queue.length > 0) {
        const item = queue.shift();
        if (!item) return;

        const controller = new AbortController();
        controllers.add(controller);
        try {
          const cachedTranscript = await fetchCachedVideoTranscript(
            item.id,
            controller.signal,
          );
          commitTranscriptCache(item.id, {
            status: "ready",
            segments: cachedTranscript.segments,
          });
          continue;
        } catch {
          if (controller.signal.aborted) return;
        }

        try {
          const transcript = await fetchTranscript(item.id, controller.signal);
          commitTranscriptCache(item.id, {
            status: "ready",
            segments: transcript.segments,
          });
          void saveCachedVideoTranscript(
            {
              video_id: item.id,
              source_lang: transcript.source_lang,
              segments: transcript.segments,
            },
            controller.signal,
          ).catch((saveError) => {
            if (!controller.signal.aborted) {
              console.warn("Transcript cache save failed:", saveError);
            }
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          commitTranscriptCache(item.id, {
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "Transcript fetch failed.",
          });
        } finally {
          controllers.delete(controller);
        }
      }
    };

    for (
      let index = 0;
      index < Math.min(TRANSCRIPT_SEARCH_CONCURRENCY, toLoad.length);
      index += 1
    ) {
      void loadNext();
    }

    return () => {
      cancelled = true;
      controllers.forEach((controller) => controller.abort());
    };
  }, [
    open,
    transcriptSearchCandidates,
    transcriptSearchEnabled,
  ]);

  if (!open) return null;

  async function send(
    mode: AssistantMode,
    userText: string,
    question?: string,
  ) {
    const trimmedQuestion = question?.trim();
    if (mode === "question" && !trimmedQuestion) return;

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: mode === "question" ? trimmedQuestion || userText : userText,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setLoading(true);

    try {
      const response = await chatWithAssistant({
        mode,
        question: trimmedQuestion,
        video_id: videoId || undefined,
        current_time: currentTime,
        segments: compactSegments(segments, mode, currentTime),
      });

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          content: response.answer,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Туслах хариу өгөхөд алдаа гарлаа.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send("question", draft, draft);
  }

  function selectHistoryResult(item: HistoryItem) {
    setMessages((current) => [
      ...current,
      {
        id: makeId(),
        role: "assistant",
        content: `Opening "${item.title}".`,
      },
    ]);
    setHistoryQuery("");
    onSelectHistory(item);
  }

  return (
    <section
      className="dashboard-assistant-panel"
      role="dialog"
      aria-label="Assistant chat"
    >
      <div className="dashboard-assistant-header">
        <div className="dashboard-assistant-title">
          <span className="dashboard-assistant-avatar" aria-hidden="true">
            <Bot size={18} />
          </span>
          <div>
            <strong>HELEX Assistant</strong>
            <small>
              {hasTranscript ? "Transcript ready" : "Transcript хүлээж байна"}
            </small>
          </div>
        </div>
        <div className="dashboard-panel-toggle" aria-label="Right panel view">
          <button type="button" onClick={onClose} aria-pressed="false">
            <NotebookPen size={14} aria-hidden="true" />
            <span>Notes</span>
          </button>
          <button type="button" className="is-active" aria-pressed="true">
            <Bot size={14} aria-hidden="true" />
            <span>AI Assistant</span>
          </button>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="dashboard-notes-icon-button"
          aria-label="Collapse AI assistant"
          title="Collapse AI assistant"
        >
          <PanelRightClose size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="dashboard-assistant-actions">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          const disabled =
            loading || (action.mode !== "help" && !hasTranscript);
          return (
            <button
              key={action.mode}
              type="button"
              disabled={disabled}
              onClick={() => void send(action.mode, action.userText)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>

      <form
        className="dashboard-assistant-history-search"
        onSubmit={(event) => {
          event.preventDefault();
          const [firstMatch] = historyMatches;
          if (firstMatch) selectHistoryResult(firstMatch.item);
        }}
      >
        <label htmlFor="assistant-history-search">
          <History size={14} aria-hidden="true" />
          <span>History transcript search</span>
        </label>
        <div className="dashboard-assistant-history-field">
          <Search size={14} aria-hidden="true" />
          <input
            id="assistant-history-search"
            type="search"
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
            placeholder="Search watched videos or transcript..."
          />
        </div>
        {showHistorySearch && (
          <div className="dashboard-assistant-history-results">
            {historyMatches.length > 0 ? (
              historyMatches.map((match) => (
                <button
                  key={match.item.id}
                  type="button"
                  className="dashboard-assistant-history-result"
                  onClick={() => selectHistoryResult(match.item)}
                >
                  <PlayCircle size={15} aria-hidden="true" />
                  <span className="dashboard-assistant-history-copy">
                    <strong>{match.item.title}</strong>
                    <small>
                      {[
                        match.source === "transcript" ? "Transcript" : "Title",
                        match.item.speaker,
                        formatHistoryProgress(match.item),
                      ]
                        .filter(Boolean)
                        .join(" - ")}
                    </small>
                    {match.snippet && (
                      <span className="dashboard-assistant-history-snippet">
                        {match.snippet}
                      </span>
                    )}
                  </span>
                </button>
              ))
            ) : transcriptSearchEnabled && transcriptLoadingCount > 0 ? (
              <div className="dashboard-assistant-history-empty">
                Scanning transcripts...
              </div>
            ) : (
              <div className="dashboard-assistant-history-empty">
                No history or transcript match
              </div>
            )}
            {transcriptSearchEnabled && transcriptLoadingCount > 0 && (
              <div className="dashboard-assistant-history-empty">
                Transcript scan {transcriptReadyCount}/
                {transcriptSearchCandidates.length}
              </div>
            )}
          </div>
        )}
      </form>

      <div className="dashboard-assistant-messages dashboard-scroll">
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "dashboard-assistant-message is-user"
                : "dashboard-assistant-message"
            }
          >
            {message.content}
          </div>
        ))}
        {loading && (
          <div className="dashboard-assistant-message is-loading">
            Хариу боловсруулж байна...
          </div>
        )}
      </div>

      <form className="dashboard-assistant-input-row" onSubmit={submitQuestion}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Асуух зүйлээ бич..."
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !draft.trim()}
          aria-label="Send message"
          title="Send"
        >
          <Send size={16} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

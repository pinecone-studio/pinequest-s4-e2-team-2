"use client";

// One collapsible sidebar with 5 conditionally-rendered tabs.
//   Free tabs : history, recommendations
//   Paid tabs : notes, summary, ai   (gated on useUI().isSubscribed)
//
// Every tab reads its data straight from the providers — UIProvider (user data:
// history / recommendations / notes) and VideoProcessProvider (the selected
// video + player). No prop drilling: the only prop that travels down is the
// active video id the recommendations tab needs to exclude itself.

import { useEffect, useState } from "react";
import {
  Bot,
  History,
  Lightbulb,
  Lock,
  Notebook,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useUI } from "@/_comps/providers/UIprovider";
import { useVideoProcess } from "@/_comps/providers/VideoProcessProvider";
import { HistoryCard } from "@/_comps/dashboard/HistoryCard";
import { NoteEditor } from "@/_comps/dashboard/NoteEditor";
import { NoteList } from "@/_comps/dashboard/NoteList";
import { AssistantChat } from "@/_comps/dashboard/AssistantChat";
import {
  chatWithAssistant,
  type AssistantSegmentPayload,
  type Segment,
} from "@/lib/backend-api";

type YTsidebarTab = "history" | "recommendations" | "notes" | "summary" | "ai";

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// Title + channel of the active video → a YouTube recommendation search query.
function recommendationQuery(title?: string, channel?: string): string {
  return [title === "YouTube video" ? "" : title, channel]
    .filter(Boolean)
    .join(" ")
    .slice(0, 110);
}

// Segments → assistant payload, capped so we never post an oversized transcript.
function toAssistantSegments(
  segments: Segment[],
  maxChars = 16000,
): AssistantSegmentPayload[] {
  const out: AssistantSegmentPayload[] = [];
  let used = 0;
  for (const s of segments) {
    const len = (s.translated_text || s.text || "").length;
    if (!len) continue;
    if (used + len > maxChars) break;
    used += len;
    out.push({
      start: s.start,
      duration: s.duration,
      text: s.text,
      translated_text: s.translated_text,
    });
  }
  return out;
}

const FREE_TABS: { id: YTsidebarTab; label: string; icon: LucideIcon }[] = [
  { id: "history", label: "Түүх", icon: History },
  { id: "recommendations", label: "Санал", icon: Sparkles },
];
const PAID_TABS: { id: YTsidebarTab; label: string; icon: LucideIcon }[] = [
  { id: "notes", label: "Тэмдэглэл", icon: Notebook },
  { id: "summary", label: "Дүгнэлт", icon: Lightbulb },
  { id: "ai", label: "AI", icon: Bot },
];

export function YTsidebar() {
  // isSubscribed = real paid user. allowAccess = demo unlock via "Туршилтаар
  // нэвтрэх" (see UIProvider). Either one unlocks the paid tabs.
  const { isSubscribed, allowAccess } = useUI();
  const { videoId } = useVideoProcess();
  const [open, setOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<YTsidebarTab>("history");

  const paidUnlocked = isSubscribed || allowAccess;
  const isPaidTab = (id: YTsidebarTab) => PAID_TABS.some((t) => t.id === id);
  // Paid tabs are always visible but LOCKED until unlocked — so a locked tab
  // can never be the active one.
  const effectiveTab =
    isPaidTab(activeTab) && !paidUnlocked ? "history" : activeTab;

  if (!open) {
    return (
      <aside className="lg:w-12 lg:shrink-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center rounded-md border border-border p-2 text-muted-foreground hover:bg-accent"
          aria-label="Хажуугийн самбар нээх"
          title="Нээх"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-full flex-col gap-4 overflow-y-auto lg:w-80 lg:shrink-0">
      <div className="flex items-center gap-1 rounded-lg border border-border p-1">
        {[...FREE_TABS, ...PAID_TABS].map((tab) => {
          const locked = isPaidTab(tab.id) && !paidUnlocked;
          const Icon = locked ? Lock : tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={locked}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${
                effectiveTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              } ${locked ? "cursor-not-allowed opacity-50" : ""}`}
              title={locked ? `${tab.label} — Про хэрэглэгчид` : tab.label}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden xl:inline">{tab.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-1 rounded-md p-2 text-muted-foreground hover:bg-accent"
          aria-label="Хажуугийн самбар хаах"
          title="Хаах"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {effectiveTab === "history" && <HistoryTab />}
      {effectiveTab === "recommendations" && (
        <RecommendationsTab selectedVideoId={videoId} />
      )}
      {effectiveTab === "notes" && <NotesTab />}
      {effectiveTab === "summary" && <SummaryTab />}
      {effectiveTab === "ai" && (
        <AiTab onClose={() => setActiveTab("notes")} />
      )}
    </aside>
  );
}

// ── Tab: watch history ──────────────────────────────────────────────────────
function HistoryTab() {
  const { history, historyLoading, historyError } = useUI();
  const { videoId, selectVideo } = useVideoProcess();

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-widest text-muted-foreground">
        ҮЗСЭН ТҮҮХ
      </h3>
      {historyLoading ? (
        <p className="text-sm text-muted-foreground">Түүх ачааллаж байна...</p>
      ) : historyError ? (
        <p className="text-sm text-destructive">{historyError}</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Видео сонгоод үзвэл энд түүх харагдана.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((item) => (
            <HistoryCard
              key={item.id}
              item={item}
              active={item.id === videoId}
              onSelect={() =>
                selectVideo(watchUrl(item.id), {
                  title: item.title,
                  channelTitle: item.speaker,
                  thumbnailUrl: item.thumbnailUrl,
                  durationSeconds: item.durationSeconds,
                })
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Tab: YouTube recommendations ────────────────────────────────────────────
function RecommendationsTab({ selectedVideoId }: { selectedVideoId: string }) {
  const {
    recommendations,
    recommendationsLoading,
    recommendationsError,
    loadRecommendations,
  } = useUI();
  const { selectedVideo, selectVideo } = useVideoProcess();

  // [API] Recommendations follow the active video.
  useEffect(() => {
    loadRecommendations(
      recommendationQuery(selectedVideo?.title, selectedVideo?.channelTitle),
      selectedVideoId,
    );
  }, [selectedVideo, selectedVideoId, loadRecommendations]);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-widest text-muted-foreground">
        YOUTUBE САНАЛ БОЛГОЖ БАЙНА
      </h3>
      {recommendationsLoading ? (
        <p className="text-sm text-muted-foreground">Санал ачааллаж байна...</p>
      ) : recommendationsError ? (
        <p className="text-sm text-destructive">{recommendationsError}</p>
      ) : recommendations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Видео сонгосны дараа санал харагдана.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {recommendations.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                selectVideo(item.url, {
                  title: item.title,
                  channelTitle: item.channelTitle,
                  thumbnailUrl: item.thumbnailUrl,
                })
              }
              className="flex gap-3 rounded-lg border border-border p-2 text-left hover:bg-accent"
            >
              <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnailUrl}
                  alt={item.title}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex min-w-0 flex-col justify-center">
                <span className="line-clamp-2 text-sm font-medium">
                  {item.title}
                </span>
                <small className="truncate text-xs text-muted-foreground">
                  {[item.channelTitle, item.durationLabel, item.ago]
                    .filter(Boolean)
                    .join(" · ") || "YouTube video"}
                </small>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Tab: notes (paid) ───────────────────────────────────────────────────────
function NotesTab() {
  const { notes, notesLoading, loadNotes, addNote } = useUI();
  const { videoId, player } = useVideoProcess();
  const [draft, setDraft] = useState("");
  const [justAdded, setJustAdded] = useState<string | null>(null);

  // [API] Load this video's saved notes whenever the selection changes.
  useEffect(() => {
    loadNotes(videoId);
  }, [videoId, loadNotes]);

  const sorted = [...notes].sort((a, b) => a.time - b.time);

  async function handleAdd() {
    const text = draft.trim();
    if (!text || !videoId) return;
    // [API] Persist the note at the current playback second.
    const note = await addNote(videoId, Math.floor(player.time * 1000), text);
    setDraft("");
    setJustAdded(note.id);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-widest text-muted-foreground">
        ТЭМДЭГЛЭЛ
      </h3>
      {notesLoading ? (
        <p className="text-sm text-muted-foreground">Тэмдэглэл ачааллаж байна...</p>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <NoteList notes={sorted} justAdded={justAdded} onJump={player.seek} />
        </div>
      )}
      <NoteEditor
        draft={draft}
        onDraftChange={setDraft}
        onAddNote={() => void handleAdd()}
      />
    </section>
  );
}

// ── Tab: AI summary (paid) ──────────────────────────────────────────────────
function SummaryTab() {
  const { videoId, processedSegments, player } = useVideoProcess();
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const hasTranscript = processedSegments.length > 0;

  async function generate() {
    setLoading(true);
    setError("");
    try {
      // [API] Ask the assistant for a full-video summary.
      const res = await chatWithAssistant({
        mode: "summary",
        video_id: videoId || undefined,
        current_time: player.time,
        segments: toAssistantSegments(processedSegments),
      });
      setSummary(res.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Дүгнэлт гаргахад алдаа гарлаа.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold tracking-widest text-muted-foreground">
        ДҮГНЭЛТ
      </h3>
      <button
        type="button"
        onClick={() => void generate()}
        disabled={loading || !hasTranscript}
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {loading
          ? "Дүгнэж байна..."
          : hasTranscript
            ? "Дүгнэлт гаргах"
            : "Видео сонгоно уу"}
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {summary && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {summary}
        </p>
      )}
    </section>
  );
}

// ── Tab: AI assistant (paid) ────────────────────────────────────────────────
function AiTab({ onClose }: { onClose: () => void }) {
  const { videoId, processedSegments, player, selectVideo } = useVideoProcess();
  const { history } = useUI();

  return (
    <AssistantChat
      open
      videoId={videoId}
      currentTime={player.time}
      segments={processedSegments}
      historyItems={history}
      onClose={onClose}
      onCollapse={onClose}
      onSelectHistory={(item) =>
        selectVideo(watchUrl(item.id), {
          title: item.title,
          channelTitle: item.speaker,
          thumbnailUrl: item.thumbnailUrl,
          durationSeconds: item.durationSeconds,
        })
      }
    />
  );
}

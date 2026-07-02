"use client";

import { useMemo } from "react";
import type { Segment } from "@/lib/backend-api";

type SubtitlePaneProps = {
  segments: Segment[];
  currentTime: number; // seconds, from the YouTube player (player.time)
  loading?: boolean;
  error?: string;
  // User's dub-speed pref (1 = default, 2 = 2× faster, 0.5 = half). Only
  // affects the karaoke-style highlight so it stays in sync with the audio.
  dubSpeed?: number;
};

// Shows the single subtitle line whose [start, start + duration) window contains
// the current playback time. It re-evaluates on every player tick (~4x/sec), so
// the line switches automatically as the video plays. Words are lit up
// progressively so the user can see roughly where Azure TTS is currently reading
// (karaoke-style — approximate; Azure Speech doesn't return word timings, so we
// scale by the TTS audio length + fitRate + dubSpeed instead).
export function SubtitlePane({
  segments,
  currentTime,
  loading,
  error,
  dubSpeed = 1,
}: SubtitlePaneProps) {
  const active = useMemo(() => {
    const seg = segments.find(
      (s) => currentTime >= s.start && currentTime < s.start + s.duration,
    );
    if (!seg) return null;
    // Prefer the Mongolian translation; fall back to the original caption.
    const text = seg.translated_text?.trim() || seg.text;
    if (!text) return null;

    const videoElapsed = currentTime - seg.start;
    const dur = Math.max(0.1, seg.duration);

    // If we know the TTS audio's real length, base progress on the dub's audio
    // media clock (video time × dubSpeed × fitRate). This makes the highlight
    // race ahead when the user picks a faster dub, and lag when slower.
    // Fall back to raw video progress for translate-only subtitles that never
    // ran through TTS (audio_ms == null).
    let progress: number;
    if (seg.audio_ms && seg.audio_ms > 0) {
      const audioSeconds = seg.audio_ms / 1000;
      const fitRate =
        audioSeconds > dur
          ? Math.min(1.35, Math.max(1, audioSeconds / dur))
          : 1;
      const audioElapsed = videoElapsed * dubSpeed * fitRate;
      progress = Math.max(0, Math.min(1, audioElapsed / audioSeconds));
    } else {
      progress = Math.max(0, Math.min(1, videoElapsed / dur));
    }
    return { text, progress };
  }, [segments, currentTime, dubSpeed]);

  if (active) {
    // Split on whitespace while keeping the spaces so the rendered layout is
    // unchanged. Only word tokens are counted / highlighted.
    const tokens = active.text.split(/(\s+)/);
    const wordCount = tokens.filter((t) => t.trim().length > 0).length;
    const litCount = Math.min(wordCount, Math.ceil(active.progress * wordCount));
    let wordIdx = 0;
    return (
      <div className="dashboard-subtitle-pane">
        <p className="dashboard-subtitle-text">
          {tokens.map((token, i) => {
            if (!token.trim()) return <span key={i}>{token}</span>;
            const isRead = wordIdx < litCount;
            wordIdx++;
            return (
              <span
                key={i}
                className={`dashboard-subtitle-word${isRead ? " is-read" : ""}`}
              >
                {token}
              </span>
            );
          })}
        </p>
      </div>
    );
  }

  // No active line yet — surface load/error status instead of an empty bar.
  const status = error || (loading ? "Хадмал ачааллаж байна..." : "");
  if (!status) return null;

  return (
    <div className="dashboard-subtitle-pane">
      <p className="dashboard-subtitle-status">{status}</p>
    </div>
  );
}

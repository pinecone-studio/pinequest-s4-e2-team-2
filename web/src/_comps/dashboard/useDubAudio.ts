"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  streamProcess,
  base64ToBlobUrl,
  type StreamedSegment,
} from "@/lib/process-stream";
import type { Segment } from "@/lib/backend-api";
import { VOICES } from "./voices";

export type DubStep =
  | "idle"
  | "fetching"
  | "translating"
  | "tts"
  | "ready"
  | "error";

type DubSegment = {
  start: number;
  duration: number;
  translatedText: string | null;
  blobUrl: string | null;
  audioMs: number;
};

const MAX_OVERLAPPING_DUB_AUDIO = 2;

// Azure TTS streaming dub. Reuses captions already fetched by useProcessedVideo,
// sends them to the backend /process pipeline (translate + TTS), and plays each
// segment's audio synced to the video.
export function useDubAudio(
  videoId: string,
  currentTime: number,
  playing: boolean,
  enabled: boolean,
  sourceSegments: Segment[],
  sourceLang: string,
  voiceId: string,
  playbackRate: number = 1,
  volume: number = 100,
) {
  const [segments, setSegments] = useState<DubSegment[]>([]);
  const [step, setStep] = useState<DubStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // Keyed by segment `start` (stable across renders) — array indices shift as
  // streamed segments get sorted in, which previously restarted playing audio.
  const activeAudiosRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  // Per-audio fit-rate: audio may be pitched to fit its target segment duration.
  // We store it so slider-driven playbackRate changes preserve the fit factor
  // instead of overwriting it with the raw slider value.
  const fitRatesRef = useRef<WeakMap<HTMLAudioElement, number>>(new WeakMap());
  const lastStartedKeyRef = useRef<number>(-1);
  const prevTimeRef = useRef<number>(-1);
  const abortRef = useRef<AbortController | null>(null);
  const blobUrlsRef = useRef<string[]>([]);
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Key (`videoId::voiceId`) of the dub already built. Toggling the dub off/on
  // must NOT re-run the /process translate+TTS pipeline — only a new video or
  // voice should rebuild. Set once a build COMPLETES; cleared on failure so a
  // retry can rebuild.
  const builtKeyRef = useRef<string>("");

  const stopAllAudio = useCallback(() => {
    activeAudiosRef.current.forEach((audio) => {
      audio.pause();
      audio.src = "";
    });
    activeAudiosRef.current.clear();
  }, []);

  const revokeBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, []);

  const pauseAllAudio = useCallback(() => {
    activeAudiosRef.current.forEach((audio) => {
      audio.pause();
    });
  }, []);

  const resumeAllAudio = useCallback(() => {
    activeAudiosRef.current.forEach((audio) => {
      audio.play().catch((e) => console.warn("[DubAudio] resume blocked:", e));
    });
  }, []);

  const pruneOverlappingAudio = useCallback(() => {
    const entries = [...activeAudiosRef.current.entries()];
    while (entries.length > MAX_OVERLAPPING_DUB_AUDIO) {
      const [key, audio] = entries.shift()!;
      audio.pause();
      audio.src = "";
      activeAudiosRef.current.delete(key);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (flushRef.current) clearTimeout(flushRef.current);
      stopAllAudio();
      abortRef.current?.abort();
      revokeBlobUrls();
    };
  }, []);

  // Build translate/TTS pipeline when video or voice changes. Toggling `enabled`
  // does NOT rebuild — `builtKeyRef` makes it a pure on/off switch.
  useEffect(() => {
    if (!videoId || !enabled || sourceSegments.length === 0) return;

    // Already built this video+voice → reuse it. This is what makes the dub
    // toggle a pure on/off switch instead of a "re-translate" trigger.
    const buildKey = `${videoId}::${voiceId}`;
    if (builtKeyRef.current === buildKey) return;

    stopAllAudio();
    lastStartedKeyRef.current = -1;
    prevTimeRef.current = -1;
    abortRef.current?.abort();
    // Release old blob URLs before allocating new ones for the rebuild.
    revokeBlobUrls();
    const total = sourceSegments.length;
    const stateTimer = setTimeout(() => {
      setSegments([]);
      setError(null);
      setProgress({ done: 0, total });
      setStep("translating");
    }, 0);

    const controller = new AbortController();
    abortRef.current = controller;

    // Backend picks the Azure voice by gender (Bataa=male, Yesui=female).
    const gender = VOICES.find((v) => v.id === voiceId)?.gender ?? "female";

    void (async () => {
      try {
        const built: DubSegment[] = [];
        let ttsCompleted = 0;

        await streamProcess(
          {
            video_id: videoId,
            source_lang: sourceLang,
            segments: sourceSegments.map((s) => ({
              start: s.start,
              duration: s.duration,
              text: s.text,
            })),
            voice: voiceId,
            gender,
          },
          {
            onSegment: (
              seg: StreamedSegment,
              index: number,
              segTotal: number,
            ) => {
              if (controller.signal.aborted) return;
              const blobUrl = seg.audio_b64
                ? base64ToBlobUrl(seg.audio_b64)
                : null;
              if (blobUrl) blobUrlsRef.current.push(blobUrl);
              ttsCompleted++;
              built[index] = {
                start: seg.offset,
                duration: seg.duration,
                translatedText: seg.translated_text ?? null,
                blobUrl,
                audioMs: seg.audio_ms,
              };
              // First segment: flush immediately so playback can start without delay.
              // Subsequent segments: batch into a single render every 80ms.
              if (ttsCompleted === 1) {
                if (flushRef.current) clearTimeout(flushRef.current);
                setSegments(
                  [...built].filter(Boolean).sort((a, b) => a.start - b.start),
                );
                setProgress({ done: 1, total: segTotal });
                setStep("tts");
              } else {
                setProgress({ done: ttsCompleted, total: segTotal });
                if (flushRef.current) clearTimeout(flushRef.current);
                flushRef.current = setTimeout(
                  () =>
                    setSegments(
                      [...built]
                        .filter(Boolean)
                        .sort((a, b) => a.start - b.start),
                    ),
                  80,
                );
              }
            },
            onDone: () => {
              if (controller.signal.aborted) return;
              if (flushRef.current) clearTimeout(flushRef.current);
              setSegments(
                [...built].filter(Boolean).sort((a, b) => a.start - b.start),
              );
              if (blobUrlsRef.current.length === 0) {
                setError(
                  "Azure TTS audio uusgej chadsangui. Backend credentials shalgana uu.",
                );
                setStep("error");
                builtKeyRef.current = ""; // failed → allow a rebuild on retry
              } else {
                setStep("ready");
                builtKeyRef.current = buildKey; // built → toggling won't re-run /process
              }
              setProgress(null);
            },
            onError: (msg: string) => {
              if (controller.signal.aborted) return;
              setError(msg);
              setStep("error");
              setProgress(null);
              builtKeyRef.current = ""; // failed → allow a rebuild on retry
            },
          },
          controller.signal,
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error ? err.message : "Дуб бэлдэхэд алдаа гарлаа",
        );
        setStep("error");
        setProgress(null);
        builtKeyRef.current = ""; // failed → allow a rebuild on retry
      }
    })();

    return () => {
      clearTimeout(stateTimer);
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
      if (flushRef.current) clearTimeout(flushRef.current);
    };
  }, [
    videoId,
    enabled,
    sourceSegments,
    sourceLang,
    voiceId,
    stopAllAudio,
    revokeBlobUrls,
  ]);

  // Toggle-off: stop playback but KEEP segments + blob URLs alive so toggling
  // back on plays instantly from the same built dub. Rebuild only happens when
  // videoId or voiceId changes (see builtKeyRef above).
  useEffect(() => {
    if (enabled) return;
    stopAllAudio();
    lastStartedKeyRef.current = -1;
    prevTimeRef.current = -1;
  }, [enabled, stopAllAudio]);

  // Apply playback rate changes to currently playing audio. Multiply by each
  // audio's fit-rate so slider changes don't undo the duration-fit stretch.
  useEffect(() => {
    activeAudiosRef.current.forEach((audio) => {
      const fit = fitRatesRef.current.get(audio) ?? 1;
      audio.playbackRate = playbackRate * fit;
    });
  }, [playbackRate]);

  useEffect(() => {
    const vol = Math.max(0, Math.min(1, volume / 100));
    activeAudiosRef.current.forEach((audio) => {
      audio.volume = vol;
    });
  }, [volume]);

  // Pause/resume dub audio in sync with the video
  useEffect(() => {
    if (!enabled) return;
    if (!playing) {
      pauseAllAudio();
    } else {
      resumeAllAudio();
    }
  }, [playing, enabled, pauseAllAudio, resumeAllAudio]);

  // Sync audio to video playback time. Keys audio by segment `start` (stable
  // across renders) so re-sorting the array as new segments stream in never
  // restarts the currently-playing dub.
  useEffect(() => {
    if (!enabled || !playing || segments.length === 0) return;

    // Seek detection: the player time polls every ~250ms, so a jump larger than
    // ~1.5s (scaled by playback rate) means the user seeked. Kill stale audio
    // and allow the current segment to restart from the right offset.
    const prev = prevTimeRef.current;
    prevTimeRef.current = currentTime;
    const seeked =
      prev >= 0 &&
      Math.abs(currentTime - prev) > Math.max(1.5, playbackRate * 1.5);
    if (seeked) {
      stopAllAudio();
      lastStartedKeyRef.current = -1;
    }

    const seg = segments.find(
      (s) => currentTime >= s.start && currentTime < s.start + s.duration,
    );
    if (!seg || !seg.blobUrl) return;

    // Same segment already started for this playback pass; do not restart it.
    if (seg.start === lastStartedKeyRef.current) return;

    const audio = new Audio(seg.blobUrl);
    const audioSeconds = seg.audioMs > 0 ? seg.audioMs / 1000 : 0;
    const targetSeconds = Math.max(0.1, seg.duration);
    const fitRate =
      audioSeconds > targetSeconds
        ? Math.min(1.35, Math.max(1, audioSeconds / targetSeconds))
        : 1;

    // Landing mid-segment (seek or late-arriving audio): start the audio at the
    // matching position instead of the segment's beginning. Audio media time
    // advances fitRate× faster than video time, hence the scaling. Clamp to the
    // audio's actual length so we never seek past the end (which throws).
    const offset = currentTime - seg.start;
    if (offset > 0.3 && audioSeconds > 0) {
      audio.currentTime = Math.min(
        offset * fitRate,
        Math.max(0, audioSeconds - 0.05),
      );
    }

    audio.volume = Math.max(0, Math.min(1, volume / 100));
    audio.playbackRate = playbackRate * fitRate;
    fitRatesRef.current.set(audio, fitRate);
    const key = seg.start;
    audio.onended = () => {
      if (activeAudiosRef.current.get(key) === audio)
        activeAudiosRef.current.delete(key);
    };

    activeAudiosRef.current.set(key, audio);
    lastStartedKeyRef.current = key;
    pruneOverlappingAudio();
    audio.play().catch((e) => console.warn("[DubAudio] play() blocked:", e));
  }, [
    currentTime,
    segments,
    enabled,
    playing,
    playbackRate,
    volume,
    pruneOverlappingAudio,
    stopAllAudio,
  ]);

  // Translated lines for SubtitlePane (available as soon as translation lands).
  // audio_ms is passed through so the pane can compute karaoke-style progress
  // based on the actual TTS audio length (which the dub-speed slider affects),
  // not just the segment's video-time duration.
  const translatedSegments: Segment[] = segments
    .filter((s) => s.translatedText !== null)
    .map((s) => ({
      start: s.start,
      duration: s.duration,
      text: s.translatedText!,
      source: "youtube_captions" as const,
      translated_text: s.translatedText,
      audio_path: null,
      audio_ms: s.audioMs > 0 ? s.audioMs : null,
      audio_b64: null,
    }));

  const audioSegments: { start: number; duration: number; ready: boolean }[] =
    [];
  return {
    step,
    error,
    progress,
    segmentCount: segments.length,
    translatedSegments,
    audioSegments,
  };
}

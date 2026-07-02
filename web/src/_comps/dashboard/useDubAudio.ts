"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  streamProcess,
  base64ToBlobUrl,
  type StreamedSegment,
} from "@/lib/process-stream";
import {
  createDubJob,
  pollDubJob,
  type DubJob,
} from "@/lib/dub-job";
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

// Azure/F5 dub. Reuses captions already fetched by useProcessedVideo, sends
// them to the backend (Azure /process SSE, or F5's async /jobs), and plays
// each segment's audio synced to the video.
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
  // Live audio playback position — SubtitlePane uses this so the karaoke
  // highlight follows the actual TTS clock, not just a video-time estimate.
  const [audioProgress, setAudioProgress] = useState<{
    segmentStart: number;
    audioTime: number;
    audioSeconds: number;
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
  // rAF poller for the currently-playing audio's clock. `timeupdate` fires only
  // ~4Hz on Chrome so the karaoke lags behind the voice — rAF lets us push a
  // fresh audioProgress at up to display refresh rate (~60Hz).
  const rafIdRef = useRef<number | null>(null);
  const lastPublishedTimeRef = useRef<number>(-1);
  const currentActiveAudioRef = useRef<{
    audio: HTMLAudioElement;
    key: number;
    audioSeconds: number;
  } | null>(null);
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
    currentActiveAudioRef.current = null;
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
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

  // rAF loop: publishes the active audio's live time so SubtitlePane's karaoke
  // stays glued to the voice. Only runs while an audio is playing; auto-stops
  // when the audio pauses, ends, or gets swapped for a different segment.
  const stopRafPoll = useCallback(() => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const startRafPoll = useCallback(() => {
    stopRafPoll();
    const tick = () => {
      const info = currentActiveAudioRef.current;
      if (!info) {
        rafIdRef.current = null;
        return;
      }
      const { audio, key, audioSeconds } = info;
      // Bail out if this audio is no longer the active one for its segment
      // (swapped out, pruned, or user disabled dub).
      if (activeAudiosRef.current.get(key) !== audio || audio.paused) {
        rafIdRef.current = null;
        return;
      }
      const t = audio.currentTime;
      // Only push a new state if the audio clock advanced meaningfully (>10ms)
      // — avoids piling up identical renders when the tab is idle.
      if (Math.abs(t - lastPublishedTimeRef.current) > 0.01) {
        lastPublishedTimeRef.current = t;
        setAudioProgress({ segmentStart: key, audioTime: t, audioSeconds });
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, [stopRafPoll]);

  useEffect(() => {
    return () => {
      if (flushRef.current) clearTimeout(flushRef.current);
      stopRafPoll();
      stopAllAudio();
      abortRef.current?.abort();
      revokeBlobUrls();
    };
  }, [stopRafPoll]);

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

    const selectedVoice = VOICES.find((v) => v.id === voiceId) ?? VOICES[0]!;
    const transcriptSegments = sourceSegments.map((s) => ({
      start: s.start,
      duration: s.duration,
      text: s.text,
    }));

    const applyF5Job = (job: DubJob) => {
      const mapped = job.segments
        .map((seg) => ({
          start: seg.start,
          duration: seg.duration,
          translatedText: seg.translated_text ?? null,
          blobUrl: seg.audio_url,
          audioMs: seg.audio_ms ?? 0,
        }))
        .sort((a, b) => a.start - b.start);
      const ready = mapped.filter((seg) => seg.blobUrl).length;
      setSegments(mapped);
      setProgress({ done: ready, total: mapped.length || total });
      if (ready > 0) setStep("tts");
    };

    void (async () => {
      try {
        if (selectedVoice.provider === "f5") {
          // Cloning the ORIGINAL speaker's voice from the source video was
          // tried (pick a ~10s window via pick-ref-window.ts, fetch it via
          // /api/youtube/audio-ref) and the plumbing works, but the result is
          // unintelligible whenever the source isn't already Mongolian: F5's
          // duration heuristic is UTF-8-byte-based (fixed, see gpu/f5_modal.py
          // fix_duration), but cross-script reference conditioning (Latin/other
          // ref audio + Cyrillic gen text) still comes out garbled even with
          // duration fixed — this checkpoint was fine-tuned Mongolian-only.
          // Verified 2026-07-02. Until that's solved, always use the bundled
          // Mongolian preset voice — it's the only one that reads cleanly.
          const job = await createDubJob(
            {
              video_id: videoId,
              source_lang: sourceLang,
              segments: transcriptSegments,
              voice_ref: selectedVoice.voiceRef ?? selectedVoice.id,
            },
            controller.signal,
          );
          applyF5Job(job);
          if (!job.id) throw new Error("Dub job id missing.");
          setStep("tts");

          const finalJob = await pollDubJob(job.id, {
            signal: controller.signal,
            intervalMs: 2500,
            onUpdate: applyF5Job,
          });
          if (controller.signal.aborted) return;
          applyF5Job(finalJob);
          if (finalJob.status === "failed") {
            throw new Error(finalJob.error || "F5 dub failed.");
          }
          const hasAudio = finalJob.segments.some((seg) => seg.audio_url);
          if (!hasAudio) {
            throw new Error("F5 audio uusgej chadsangui. Modal/R2 tohirgoo shalgana uu.");
          }
          setStep("ready");
          setProgress(null);
          builtKeyRef.current = buildKey;
          return;
        }

        const built: DubSegment[] = [];
        let ttsCompleted = 0;

        await streamProcess(
          {
            video_id: videoId,
            source_lang: sourceLang,
            segments: transcriptSegments,
            gender: selectedVoice.gender,
            voice: selectedVoice.id,
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
    setAudioProgress(null);
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

  // Pause/resume dub audio in sync with the video. Also toggle the karaoke
  // poller so we don't burn frames while the audio is silent.
  useEffect(() => {
    if (!enabled) return;
    if (!playing) {
      pauseAllAudio();
      stopRafPoll();
    } else {
      resumeAllAudio();
      if (currentActiveAudioRef.current) startRafPoll();
    }
  }, [playing, enabled, pauseAllAudio, resumeAllAudio, startRafPoll, stopRafPoll]);

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

    const key = seg.start;
    const audioSeconds = seg.audioMs > 0 ? seg.audioMs / 1000 : 0;
    const targetSeconds = Math.max(0.1, seg.duration);
    const fitRate =
      audioSeconds > targetSeconds
        ? Math.min(1.35, Math.max(1, audioSeconds / targetSeconds))
        : 1;
    const offset = Math.max(0, currentTime - seg.start);

    // Same segment already playing — don't restart it. But DO check drift: if
    // the audio clock has slipped from the expected position (>0.35s) — usually
    // from browser scheduling, decode delays, or the video hitting a stall —
    // snap it back so the Mongolian voice stays lined up with the subtitle.
    if (key === lastStartedKeyRef.current) {
      const existing = activeAudiosRef.current.get(key);
      if (existing && !existing.paused && audioSeconds > 0) {
        const expected = offset * fitRate;
        if (Math.abs(existing.currentTime - expected) > 0.35) {
          existing.currentTime = Math.min(
            expected,
            Math.max(0, audioSeconds - 0.05),
          );
        }
      }
      return;
    }

    const audio = new Audio(seg.blobUrl);

    // Precisely position the audio to match the video's current spot in the
    // segment — even for small offsets, so the TTS voice starts speaking at
    // exactly the right word. Audio media time runs fitRate× faster than video
    // time. Clamp to the audio's actual length so we never seek past the end.
    if (audioSeconds > 0) {
      audio.currentTime = Math.min(
        offset * fitRate,
        Math.max(0, audioSeconds - 0.05),
      );
    }

    audio.volume = Math.max(0, Math.min(1, volume / 100));
    audio.playbackRate = playbackRate * fitRate;
    fitRatesRef.current.set(audio, fitRate);

    audio.onended = () => {
      if (activeAudiosRef.current.get(key) === audio) {
        activeAudiosRef.current.delete(key);
        if (currentActiveAudioRef.current?.audio === audio) {
          currentActiveAudioRef.current = null;
          stopRafPoll();
        }
        setAudioProgress((p) => (p && p.segmentStart === key ? null : p));
      }
    };

    activeAudiosRef.current.set(key, audio);
    lastStartedKeyRef.current = key;
    // Track this as the currently-active audio so the rAF poller reads its
    // clock every frame (~60Hz) instead of relying on Chrome's ~4Hz
    // `timeupdate` — that's why the highlight lagged the voice before.
    currentActiveAudioRef.current = { audio, key, audioSeconds };
    lastPublishedTimeRef.current = -1;
    // Push an immediate snapshot so the highlight isn't stuck at the previous
    // segment for the first frame.
    setAudioProgress({ segmentStart: key, audioTime: audio.currentTime, audioSeconds });

    // Backend-reported `audio_ms` comes from mutagen and is 0 if the MP3
    // parse fails — that would leave audioSeconds=0 and force the karaoke
    // onto the slow video-time fallback (and skip the fitRate stretch, so
    // the voice would run over long segments). Once the browser has decoded
    // the MP3 header we know the real duration; patch the ref + published
    // audioProgress + playbackRate so both voice and karaoke snap to the
    // correct pace.
    const onMetadata = () => {
      const dur = audio.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;

      const realFitRate =
        dur > targetSeconds
          ? Math.min(1.35, Math.max(1, dur / targetSeconds))
          : 1;
      audio.playbackRate = playbackRate * realFitRate;
      fitRatesRef.current.set(audio, realFitRate);

      if (currentActiveAudioRef.current?.audio === audio) {
        currentActiveAudioRef.current = {
          audio,
          key,
          audioSeconds: dur,
        };
      }
      setAudioProgress((prev) =>
        prev && prev.segmentStart === key
          ? { ...prev, audioSeconds: dur, audioTime: audio.currentTime }
          : prev,
      );
    };
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      onMetadata();
    } else {
      audio.addEventListener("loadedmetadata", onMetadata, { once: true });
    }

    // Re-arm the rAF poller whenever THIS audio actually starts playing — the
    // `.then()` on play() only fires on success, so autoplay blocks would
    // silently leave the karaoke frozen. The ownership check keeps old,
    // now-secondary audios (still playing while a newer segment is active)
    // from stealing / stopping the newer audio's poll.
    const onPlaying = () => {
      if (currentActiveAudioRef.current?.audio === audio) startRafPoll();
    };
    const onPauseEvt = () => {
      if (currentActiveAudioRef.current?.audio === audio) stopRafPoll();
    };
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPauseEvt);
    const priorOnEnded = audio.onended;
    audio.onended = (ev) => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPauseEvt);
      priorOnEnded?.call(audio, ev);
    };

    pruneOverlappingAudio();
    audio.play().catch((e) => console.warn("[DubAudio] play() blocked:", e));
    // Kick off the poller now too — the tick self-bails if audio.paused is
    // still true, and the `playing` event will re-start it when audio unlocks.
    startRafPoll();
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
    segments.map((s) => ({
      start: s.start,
      duration: s.duration,
      ready: Boolean(s.blobUrl),
    }));
  return {
    step,
    error,
    progress,
    segmentCount: segments.length,
    translatedSegments,
    audioSegments,
    audioProgress,
  };
}

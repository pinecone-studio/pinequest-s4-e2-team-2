"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { streamProcess, base64ToBlobUrl, type StreamedSegment } from "@/lib/process-stream"
import type { Segment } from "@/lib/backend-api"
import { VOICES } from "./voices"

export type DubStep = "idle" | "fetching" | "translating" | "tts" | "ready" | "error"

type DubSegment = {
  start: number
  duration: number
  translatedText: string | null
  blobUrl: string | null
  audioMs: number
}

const MAX_OVERLAPPING_DUB_AUDIO = 2

// Azure TTS streaming dub. Fetches the transcript, sends it to the backend
// /process pipeline (translate + TTS), and plays each segment's audio synced
// to the video. Supports pause/resume and volume control.
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
  const [segments, setSegments] = useState<DubSegment[]>([])
  const [step, setStep] = useState<DubStep>("idle")
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const activeAudiosRef = useRef<Map<number, HTMLAudioElement>>(new Map())
  const lastStartedIdxRef = useRef<number>(-1)
  const abortRef = useRef<AbortController | null>(null)
  const blobUrlsRef = useRef<string[]>([])
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Key (`videoId::voiceId`) of the dub already built. Toggling the dub off/on
  // must NOT re-run the /process translate+TTS pipeline — only a new video or
  // voice should rebuild. Set once a build COMPLETES; cleared on failure so a
  // retry can rebuild.
  const builtKeyRef = useRef<string>("")

  const stopAllAudio = useCallback(() => {
    activeAudiosRef.current.forEach((audio) => {
      audio.pause()
      audio.src = ""
    })
    activeAudiosRef.current.clear()
  }, [])

  const pauseAllAudio = useCallback(() => {
    activeAudiosRef.current.forEach((audio) => {
      audio.pause()
    })
  }, [])

  const resumeAllAudio = useCallback(() => {
    activeAudiosRef.current.forEach((audio) => {
      audio.play().catch((e) => console.warn("[DubAudio] resume blocked:", e))
    })
  }, [])

  const pruneOverlappingAudio = useCallback(() => {
    const entries = [...activeAudiosRef.current.entries()]
    while (entries.length > MAX_OVERLAPPING_DUB_AUDIO) {
      const [idx, audio] = entries.shift()!
      audio.pause()
      audio.src = ""
      activeAudiosRef.current.delete(idx)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (flushRef.current) clearTimeout(flushRef.current)
      stopAllAudio()
      abortRef.current?.abort()
    }
  }, [])

  // Fetch transcript + stream translate/TTS when enabled or voice changes
  useEffect(() => {
    // Reuse the captions already fetched by useProcessedVideo — no second
    // transcript fetch. Wait until they've arrived before building the dub.
    if (!videoId || !enabled || sourceSegments.length === 0) return

    // Already built this video+voice → reuse it. This is what makes the dub
    // toggle a pure on/off switch instead of a "re-translate" trigger.
    const buildKey = `${videoId}::${voiceId}`
    if (builtKeyRef.current === buildKey) return

    stopAllAudio()
    lastStartedIdxRef.current = -1
    abortRef.current?.abort()
    setSegments([])
    setError(null)
    setStep("translating")
    setProgress({ done: 0, total: sourceSegments.length })

    const controller = new AbortController()
    abortRef.current = controller

    // Backend picks the Azure voice by gender (Bataa=male, Yesui=female).
    const gender = VOICES.find((v) => v.id === voiceId)?.gender ?? "female"

    void (async () => {
      try {
        const built: DubSegment[] = []

        let ttsCompleted = 0

        await streamProcess(
          {
            video_id: videoId,
            source_lang: sourceLang,
            segments: sourceSegments.map((s) => ({
              start: s.start,
              duration: s.duration,
              text: s.text,
            })),
            gender,
          },
          {
            onSegment: (seg: StreamedSegment, index: number, segTotal: number) => {
              if (controller.signal.aborted) return
              const blobUrl = seg.audio_b64 ? base64ToBlobUrl(seg.audio_b64) : null
              if (blobUrl) blobUrlsRef.current.push(blobUrl)
              ttsCompleted++
              built[index] = {
                start: seg.offset,
                duration: seg.duration,
                translatedText: seg.translated_text ?? null,
                blobUrl,
                audioMs: seg.audio_ms,
              }
              // First segment: flush immediately so playback can start without delay.
              // Subsequent segments: batch into a single render every 80ms.
              if (ttsCompleted === 1) {
                if (flushRef.current) clearTimeout(flushRef.current)
                setSegments([...built].filter(Boolean).sort((a, b) => a.start - b.start))
                setProgress({ done: 1, total: segTotal })
                setStep("tts")
              } else {
                setProgress({ done: ttsCompleted, total: segTotal })
                if (flushRef.current) clearTimeout(flushRef.current)
                flushRef.current = setTimeout(
                  () => setSegments([...built].filter(Boolean).sort((a, b) => a.start - b.start)),
                  80,
                )
              }
            },
            onDone: () => {
              if (controller.signal.aborted) return
              if (flushRef.current) clearTimeout(flushRef.current)
              setSegments([...built].filter(Boolean).sort((a, b) => a.start - b.start))
              if (blobUrlsRef.current.length === 0) {
                setError("Azure TTS audio uusgej chadsangui. Backend credentials shalgana uu.")
                setStep("error")
                builtKeyRef.current = "" // failed → allow a rebuild on retry
              } else {
                setStep("ready")
                builtKeyRef.current = buildKey // built → toggling won't re-run /process
              }
              setProgress(null)
            },
            onError: (msg: string) => {
              if (controller.signal.aborted) return
              setError(msg)
              setStep("error")
              setProgress(null)
              builtKeyRef.current = "" // failed → allow a rebuild on retry
            },
          },
          controller.signal,
        )
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : "Дуб бэлдэхэд алдаа гарлаа")
        setStep("error")
        setProgress(null)
        builtKeyRef.current = "" // failed → allow a rebuild on retry
      }
    })()

    return () => {
      controller.abort()
      if (abortRef.current === controller) abortRef.current = null
      if (flushRef.current) clearTimeout(flushRef.current)
    }
  }, [videoId, enabled, sourceSegments, sourceLang, voiceId, stopAllAudio])

  // Pause (but DON'T discard) the dub when the user switches back to the original
  // audio, so re-enabling plays instantly from the already-built segments. The
  // background build is left running/complete and its blobs are kept alive.
  useEffect(() => {
    if (enabled) return
    // Turning dub OFF: stop playback but KEEP the built segments + "ready" state,
    // so toggling back ON replays instantly without re-running /process.
    stopAllAudio()
    lastStartedIdxRef.current = -1
  }, [enabled, stopAllAudio])

  // Apply playback rate changes to currently playing audio
  useEffect(() => {
    activeAudiosRef.current.forEach((audio) => {
      audio.playbackRate = playbackRate
    })
  }, [playbackRate])

  useEffect(() => {
    const vol = Math.max(0, Math.min(1, volume / 100))
    activeAudiosRef.current.forEach((audio) => {
      audio.volume = vol
    })
  }, [volume])

  // Pause/resume dub audio in sync with the video
  useEffect(() => {
    if (!enabled) return
    if (!playing) {
      pauseAllAudio()
    } else {
      resumeAllAudio()
    }
  }, [playing, enabled, pauseAllAudio, resumeAllAudio])

  // Sync audio to video playback time
  useEffect(() => {
    if (!enabled || !playing || segments.length === 0) return

    const idx = segments.findIndex(
      (s) => currentTime >= s.start && currentTime < s.start + s.duration,
    )
    if (idx === -1) return

    // Same segment already started for this playback pass; do not restart it.
    if (idx === lastStartedIdxRef.current) return

    const seg = segments[idx]
    if (!seg.blobUrl) return

    const audio = new Audio(seg.blobUrl)
    const audioSeconds = seg.audioMs > 0 ? seg.audioMs / 1000 : 0
    const targetSeconds = Math.max(0.1, seg.duration)
    const fitRate =
      audioSeconds > targetSeconds
        ? Math.min(1.35, Math.max(1, audioSeconds / targetSeconds))
        : 1

    audio.volume = Math.max(0, Math.min(1, volume / 100))
    audio.playbackRate = playbackRate * fitRate
    audio.onended = () => {
      activeAudiosRef.current.delete(idx)
    }

    activeAudiosRef.current.set(idx, audio)
    lastStartedIdxRef.current = idx
    pruneOverlappingAudio()
    audio.play().catch((e) => console.warn("[DubAudio] play() blocked:", e))
  }, [currentTime, segments, enabled, playing, playbackRate, volume, pruneOverlappingAudio, stopAllAudio])

  // Translated lines for SubtitlePane (available as soon as translation lands).
  const translatedSegments: Segment[] = segments
    .filter((s) => s.translatedText !== null)
    .map((s) => ({
      start: s.start,
      duration: s.duration,
      text: s.translatedText!,
      source: "youtube_captions" as const,
      translated_text: s.translatedText,
      audio_path: null,
      audio_ms: null,
      audio_b64: null,
    }))

  const audioSegments: { start: number; duration: number; ready: boolean }[] = []
  return { step, error, progress, segmentCount: segments.length, translatedSegments, audioSegments }
}

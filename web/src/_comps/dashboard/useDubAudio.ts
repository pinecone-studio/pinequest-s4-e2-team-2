"use client"

import { useEffect, useRef, useState } from "react"
import { createDubJob, pollDubJob } from "@/lib/dub-job"
import type { Segment } from "@/lib/backend-api"

export type DubStep = "idle" | "fetching" | "translating" | "tts" | "ready" | "error"

type DubSegment = {
  start: number
  duration: number
  translatedText: string | null
  audioUrl: string | null // public R2 URL (was base64 blob in the old Azure flow)
}

// F5 dub. Reuses the captions already fetched by useProcessedVideo (no extra
// RapidAPI call), sends them to the backend /jobs pipeline, and plays the
// returned R2 audio synced to the video. Subtitles (translated_text) arrive
// first; audio fills in once the GPU finishes.
export function useDubAudio(
  videoId: string,
  currentTime: number,
  enabled: boolean,
  sourceSegments: Segment[],
  sourceLang: string = "en",
  voiceRef: string = "female", // preset voice key ("male"/"female")
  playbackRate: number = 1,
) {
  const [segments, setSegments] = useState<DubSegment[]>([])
  const [step, setStep] = useState<DubStep>("idle")
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeIdxRef = useRef<number>(-1)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      abortRef.current?.abort()
    }
  }, [])

  // Create the F5 dub job from the already-fetched captions, then poll for audio.
  useEffect(() => {
    if (!videoId || !enabled || sourceSegments.length === 0) return

    audioRef.current?.pause()
    audioRef.current = null
    activeIdxRef.current = -1
    abortRef.current?.abort()
    setSegments([])
    setError(null)
    const total = sourceSegments.length
    setProgress({ done: 0, total })
    setStep("translating")

    const controller = new AbortController()
    abortRef.current = controller

    void (async () => {
      try {
        const payload = sourceSegments.map((s) => ({
          start: s.start,
          duration: s.duration,
          text: s.text,
        }))

        // Translation is done server-side immediately; audio (R2 URLs) is filled
        // in once the GPU finishes (status=done).
        const job = await createDubJob(
          { video_id: videoId, source_lang: sourceLang, segments: payload, voice_ref: voiceRef },
          controller.signal,
        )
        if (controller.signal.aborted) return

        const applyJob = (segs: typeof job.segments) => {
          setSegments(
            segs.map((s) => ({
              start: s.start,
              duration: s.duration,
              translatedText: s.translated_text,
              audioUrl: s.audio_url,
            })),
          )
          setProgress({ done: segs.filter((s) => s.audio_url).length, total: segs.length || total })
        }

        applyJob(job.segments) // subtitles appear now (translation ready)
        setStep("tts")

        const finalJob = await pollDubJob(job.id, {
          signal: controller.signal,
          onUpdate: (j) => {
            if (!controller.signal.aborted) applyJob(j.segments)
          },
        })
        if (controller.signal.aborted) return

        if (finalJob.status === "failed") {
          setError(finalJob.error || "Дуб үүсгэхэд алдаа гарлаа.")
          setStep("error")
          setProgress(null)
          return
        }

        applyJob(finalJob.segments)
        setStep(finalJob.segments.some((s) => s.audio_url) ? "ready" : "error")
        if (!finalJob.segments.some((s) => s.audio_url)) setError("Дуб audio үүсгэж чадсангүй.")
        setProgress(null)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : "Дуб бэлдэхэд алдаа гарлаа")
        setStep("error")
        setProgress(null)
      }
    })()

    return () => {
      controller.abort()
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [videoId, enabled, sourceSegments, sourceLang, voiceRef])

  // Pause (but DON'T discard) the dub when the user switches back to the original
  // audio, so re-enabling plays instantly from the already-built segments. The
  // background build is left running/complete and its blobs are kept alive.
  useEffect(() => {
    if (enabled) return
    audioRef.current?.pause()
    audioRef.current = null
    activeIdxRef.current = -1
    setSegments([])
    setError(null)
    setProgress(null)
    setStep("idle")
  }, [enabled])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  // Sync audio to video playback time — play the segment whose window covers now.
  useEffect(() => {
    if (!enabled || segments.length === 0) return

    // Start a segment's audio, speeding it up (capped at 1.5×) so the WHOLE line
    // fits inside the segment window instead of being cut off when the next
    // segment starts. This is why short translations matter, but this is the
    // safety net when the dub is a bit longer than its on-screen time.
    const startSegment = (seg: DubSegment) => {
      if (!seg.audioUrl) return
      const audio = new Audio(seg.audioUrl)
      audio.playbackRate = playbackRate
      audio.addEventListener("loadedmetadata", () => {
        if (seg.duration > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
          const fit = audio.duration / seg.duration
          audio.playbackRate = Math.max(playbackRate, Math.min(playbackRate * 1.5, playbackRate * fit))
        }
      })
      audioRef.current = audio
      audio.play().catch((e) => console.warn("[DubAudio] play() blocked:", e))
    }

    const idx = segments.findIndex(
      (s) => currentTime >= s.start && currentTime < s.start + s.duration,
    )
    if (idx === -1) return

    if (idx === activeIdxRef.current) {
      if (!audioRef.current) startSegment(segments[idx])
      return
    }

    audioRef.current?.pause()
    audioRef.current = null
    activeIdxRef.current = idx
    startSegment(segments[idx])
  }, [currentTime, segments, enabled, playbackRate])

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

  // Per-segment audio readiness — lets the video buffer ONCE (wait for the first
  // needed segment) before playing, so the dub starts from the beginning.
  const audioSegments = segments.map((s) => ({
    start: s.start,
    duration: s.duration,
    ready: Boolean(s.audioUrl),
  }))

  return { step, error, progress, segmentCount: segments.length, translatedSegments, audioSegments }
}

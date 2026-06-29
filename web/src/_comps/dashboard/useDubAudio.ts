"use client"

import { useEffect, useReducer, useRef } from "react"
import { fetchTranscript, streamProcess, base64ToBlobUrl, type StreamedSegment } from "@/lib/process-stream"
import type { Segment } from "@/lib/backend-api"

export type DubStep = "idle" | "fetching" | "translating" | "tts" | "ready" | "error"

type DubSegment = {
  start: number
  duration: number
  translatedText: string | null
  blobUrl: string | null
}

// ── Session cache ────────────────────────────────────────────────────────────
// The dub (translated text + per-segment audio blobs) is cached per video+voice
// so it survives pausing, seeking/rewinding, and toggling dub off→on without
// re-fetching, re-translating, or re-synthesizing. Blobs are kept alive for the
// session and only freed when an entry is evicted (LRU) or the tab closes.
type DubEntry = {
  segments: DubSegment[]
  status: DubStep
  error: string | null
  blobUrls: string[]
  inFlight: boolean
  listeners: Set<() => void>
}

const dubCache = new Map<string, DubEntry>()
const MAX_CACHED = 4 // cap blob memory: keep dubs for the last few videos/voices

const cacheKey = (videoId: string, gender: string) => `${videoId}:${gender}`

function getEntry(key: string): DubEntry {
  let entry = dubCache.get(key)
  if (!entry) {
    entry = { segments: [], status: "idle", error: null, blobUrls: [], inFlight: false, listeners: new Set() }
    dubCache.set(key, entry)
    pruneCache(key)
  } else {
    // Mark as most-recently-used (Map keeps insertion order).
    dubCache.delete(key)
    dubCache.set(key, entry)
  }
  return entry
}

// Evict oldest entries beyond the cap, freeing their audio blobs.
function pruneCache(keepKey: string) {
  while (dubCache.size > MAX_CACHED) {
    const oldest = dubCache.keys().next().value as string | undefined
    if (!oldest || oldest === keepKey) break
    const victim = dubCache.get(oldest)
    if (victim && !victim.inFlight) {
      victim.blobUrls.forEach((url) => URL.revokeObjectURL(url))
      dubCache.delete(oldest)
    } else {
      break
    }
  }
}

function notify(entry: DubEntry) {
  entry.listeners.forEach((fn) => fn())
}

// Build the dub for a key once and stream results into the cache entry. Safe to
// call repeatedly — it no-ops if the dub is ready or already being built.
async function ensureDub(key: string, videoId: string, gender: "male" | "female") {
  const entry = getEntry(key)
  if (entry.status === "ready" || entry.inFlight) return
  entry.inFlight = true
  entry.error = null
  entry.status = "fetching"
  notify(entry)

  try {
    const transcript = await fetchTranscript(videoId)
    if (!transcript.segments.length) {
      entry.status = "error"
      entry.error = "No transcript available for this video."
      notify(entry)
      return
    }

    const built: DubSegment[] = transcript.segments.map((s) => ({
      start: s.start,
      duration: s.duration,
      translatedText: null,
      blobUrl: null,
    }))
    entry.segments = built
    entry.status = "translating"
    notify(entry)

    await streamProcess(
      { source_lang: transcript.source_lang, segments: transcript.segments, gender },
      {
        onSegment: (seg: StreamedSegment, index: number) => {
          const blobUrl = seg.audio_b64 ? base64ToBlobUrl(seg.audio_b64) : null
          if (blobUrl) entry.blobUrls.push(blobUrl)
          built[index] = {
            start: seg.offset,
            duration: seg.duration,
            translatedText: seg.translated_text ?? null,
            blobUrl,
          }
          entry.segments = [...built]
          entry.status = "tts"
          notify(entry)
        },
        onDone: () => {
          entry.status = entry.blobUrls.length === 0 ? "error" : "ready"
          if (entry.status === "error") {
            entry.error = "Azure TTS audio үүсгэж чадсангүй. Backend credentials шалгана уу."
          }
          notify(entry)
        },
        onError: (msg: string) => {
          entry.status = "error"
          entry.error = msg
          notify(entry)
        },
      },
    )
  } catch (err) {
    entry.status = "error"
    entry.error = err instanceof Error ? err.message : "Дуб бэлдэхэд алдаа гарлаа"
    notify(entry)
  } finally {
    entry.inFlight = false
  }
}

export function useDubAudio(
  videoId: string,
  currentTime: number,
  enabled: boolean,
  gender: "male" | "female",
  playbackRate: number = 1,
  playing: boolean = true, // CHANGED: pause/resume the dub with the video
) {
  // Re-render this component whenever the cached entry changes.
  const [, force] = useReducer((x) => x + 1, 0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeIdxRef = useRef<number>(-1)
  const lastTimeRef = useRef(0) // detect backward seeks (rewind) to replay a clip

  const key = videoId ? cacheKey(videoId, gender) : ""

  // Subscribe to the cache entry + kick off the build (cached → instant).
  useEffect(() => {
    if (!key || !enabled) return
    const entry = getEntry(key)
    const listener = () => force()
    entry.listeners.add(listener)
    void ensureDub(key, videoId, gender)
    force() // reflect whatever is already cached
    return () => {
      entry.listeners.delete(listener)
    }
  }, [key, enabled, videoId, gender])

  const entry = key ? dubCache.get(key) : undefined
  const segments: DubSegment[] = enabled && entry ? entry.segments : []
  const step: DubStep = enabled ? entry?.status ?? "idle" : "idle"
  const error = enabled ? entry?.error ?? null : null

  // Progress: how many segments have audio so far (shown while still building).
  const doneCount = segments.filter((s) => s.blobUrl !== null).length
  const progress =
    enabled && (step === "translating" || step === "tts") && segments.length > 0
      ? { done: doneCount, total: segments.length }
      : null

  // Stop (but don't discard) audio when dub is turned off or on unmount.
  useEffect(() => {
    if (enabled) return
    audioRef.current?.pause()
    audioRef.current = null
    activeIdxRef.current = -1
  }, [enabled])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  // Apply playback-rate changes to the currently playing clip.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  // Sync dub audio to the video: pick the segment for the current time, and
  // pause/resume in lock-step with the video so seeking/rewinding/pausing all
  // land on the right cached clip.
  useEffect(() => {
    if (!enabled || segments.length === 0) return

    // Did the user rewind? (currentTime jumped backward beyond polling jitter.)
    const seekedBack = currentTime < lastTimeRef.current - 0.4
    lastTimeRef.current = currentTime

    // Mirror the video's paused state onto the dub clip.
    if (!playing) {
      audioRef.current?.pause()
      return
    }

    const idx = segments.findIndex(
      (s) => currentTime >= s.start && currentTime < s.start + s.duration,
    )
    if (idx === -1) return // between windows — let the current clip finish

    const seg = segments[idx]

    if (idx === activeIdxRef.current) {
      // Same segment: start it if needed, replay it from the top on a rewind,
      // or resume after a *pause*. Do NOT restart a clip that simply finished —
      // a dub shorter than its segment window has `ended === true` (and reports
      // `paused`), so without this guard it would replay on every tick.
      if (!seg.blobUrl) return
      if (!audioRef.current || seekedBack) {
        audioRef.current?.pause()
        const audio = new Audio(seg.blobUrl)
        audio.playbackRate = playbackRate
        audioRef.current = audio
        audio.play().catch((e) => console.warn("[DubAudio] play() blocked:", e))
      } else if (audioRef.current.paused && !audioRef.current.ended) {
        audioRef.current.play().catch(() => {})
      }
      return
    }

    // New segment (e.g. after a seek): stop the old clip, start the new one.
    audioRef.current?.pause()
    audioRef.current = null
    activeIdxRef.current = idx
    if (!seg.blobUrl) return
    const audio = new Audio(seg.blobUrl)
    audio.playbackRate = playbackRate
    audioRef.current = audio
    audio.play().catch((e) => console.warn("[DubAudio] play() blocked:", e))
  }, [currentTime, segments, enabled, playing, playbackRate])

  // Translated text for the SubtitlePane while dub mode is active.
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

  return { step, error, progress, segmentCount: segments.length, translatedSegments }
}

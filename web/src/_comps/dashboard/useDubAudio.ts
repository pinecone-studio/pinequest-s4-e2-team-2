"use client"

import { useEffect, useRef, useState } from "react"
import type { Segment } from "@/lib/backend-api"

export type DubStep = "idle" | "translating" | "tts" | "ready" | "error"

export function useDubAudio(
  videoId: string,
  currentTime: number,
  enabled: boolean,
  gender: "male" | "female",
  playbackRate: number = 1,
) {
  const [segments, setSegments] = useState<Segment[]>([])
  const [step, setStep] = useState<DubStep>("idle")
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeIdxRef = useRef<number>(-1)
  const esRef = useRef<EventSource | null>(null)

  // Unmount cleanup
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
      esRef.current?.close()
      esRef.current = null
    }
  }, [])

  // Fetch segments via SSE when dub mode is turned on or gender changes
  useEffect(() => {
    if (!videoId || !enabled) return

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    activeIdxRef.current = -1
    esRef.current?.close()
    esRef.current = null
    setSegments([])
    setError(null)
    setProgress(null)
    setStep("translating")

    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "")
    const url = `${apiBase}/process/stream?video_id=${encodeURIComponent(videoId)}&gender=${gender}`
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (event) => {
      const data = JSON.parse(event.data as string)
      if (data.step === "translating" || data.step === "tts") {
        setStep(data.step)
        setProgress({ done: data.done, total: data.total })
      } else if (data.step === "ready") {
        setSegments(data.result.segments)
        setStep("ready")
        setProgress(null)
        es.close()
        esRef.current = null
      } else if (data.step === "error") {
        setError(data.detail ?? "Дуб бэлдэхэд алдаа гарлаа")
        setStep("error")
        setProgress(null)
        es.close()
        esRef.current = null
      }
    }

    es.onerror = () => {
      setError("Серверт холбогдоход алдаа гарлаа")
      setStep("error")
      setProgress(null)
      es.close()
      esRef.current = null
    }

    return () => {
      es.close()
      if (esRef.current === es) esRef.current = null
    }
  }, [videoId, enabled, gender])

  // Stop and clear when dub mode is turned off
  useEffect(() => {
    if (enabled) return
    esRef.current?.close()
    esRef.current = null
    audioRef.current?.pause()
    audioRef.current = null
    activeIdxRef.current = -1
    setSegments([])
    setError(null)
    setProgress(null)
    setStep("idle")
  }, [enabled])

  // Apply playback rate changes to the currently playing audio
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  // Sync audio to video playback time — runs every 250ms via currentTime
  useEffect(() => {
    if (!enabled || segments.length === 0) return

    const idx = segments.findIndex(
      (s) => currentTime >= s.start && currentTime < s.start + s.duration,
    )

    if (idx === -1) {
      audioRef.current?.pause()
      return
    }

    // Same segment — only resync if >0.5s drift
    if (idx === activeIdxRef.current && audioRef.current) {
      const expected = currentTime - segments[idx].start
      if (Math.abs(audioRef.current.currentTime - expected) > 0.5) {
        audioRef.current.currentTime = expected
      }
      return
    }

    // New segment — stop old, start new
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
      audioRef.current = null
    }

    const seg = segments[idx]
    activeIdxRef.current = idx
    if (!seg.audio_path) return

    const audioUrl = seg.audio_path.startsWith("http")
      ? seg.audio_path
      : `${(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "")}${seg.audio_path}`
    const audio = new Audio(audioUrl)
    audio.currentTime = Math.max(0, currentTime - seg.start)
    audio.playbackRate = playbackRate
    audioRef.current = audio
    audio.play().catch(() => {})
  }, [currentTime, segments, enabled])

  return { step, error, progress, segmentCount: segments.length }
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { loadYouTubeApi, type YouTubeEvent, type YouTubePlayer } from "./youtubeApi"

export function useYouTubePlayer(videoId: string, fallbackDuration = 0) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(fallbackDuration)
  const [playbackRate, setPlaybackRate] = useState(1)

  useEffect(() => {
    if (!videoId) {
      queueMicrotask(() => {
        setReady(false)
        setPlaying(false)
        setTime(0)
        setDuration(fallbackDuration)
      })
      return
    }

    let mounted = true
    const pollId = setInterval(() => {
      const player = playerRef.current
      if (player?.getCurrentTime) setTime(player.getCurrentTime() || 0)
      if (player?.getPlaybackRate) setPlaybackRate(player.getPlaybackRate() || 1)
    }, 250)

    loadYouTubeApi().then((YT) => {
      if (!mounted || !containerRef.current) return

      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        width: "100%",
        height: "100%",
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          controls: 1,
          enablejsapi: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          hl: "en",
          cc_load_policy: 0,
          iv_load_policy: 3,
          fs: 1,
        },
        events: {
          onReady: (event: YouTubeEvent) => {
            if (!mounted) return
            setReady(true)
            setDuration(event.target.getDuration?.() || fallbackDuration)
            styleIframe(event.target.getIframe?.())
          },
          onStateChange: (event: YouTubeEvent) => {
            if (!mounted) return
            setPlaying(event.data === YT.PlayerState.PLAYING)
            setDuration(event.target.getDuration?.() || fallbackDuration)
          },
        },
      })
    })

    return () => {
      mounted = false
      clearInterval(pollId)
      playerRef.current?.destroy?.()
      playerRef.current = null
    }
  }, [fallbackDuration, videoId])

  const play = useCallback(() => playerRef.current?.playVideo?.(), [])
  const pause = useCallback(() => playerRef.current?.pauseVideo?.(), [])
  const toggle = useCallback(() => (playing ? pause() : play()), [pause, play, playing])
  const seek = useCallback((value: number) => {
    playerRef.current?.seekTo?.(value, true)
    setTime(value)
  }, [])
  const mute = useCallback(() => playerRef.current?.mute?.(), [])
  const unMute = useCallback(() => playerRef.current?.unMute?.(), [])

  return { containerRef, ready, playing, time, duration, playbackRate, play, pause, toggle, seek, mute, unMute }
}

function styleIframe(iframe?: HTMLIFrameElement) {
  if (!iframe) return
  iframe.style.position = "absolute"
  iframe.style.inset = "0"
  iframe.style.width = "100%"
  iframe.style.height = "100%"
  iframe.style.border = "0"
}

"use client"

import type { RefObject } from "react"
import { SOURCE_LINE, type Note } from "./data"
import { VideoFrame } from "./VideoFrame"

type VideoPaneProps = {
  containerRef: RefObject<HTMLDivElement | null>
  ready: boolean
  notes: Note[]
  hasVideo: boolean
  title: string
  speaker: string
  sourceLine?: string
}

export function VideoPane(props: VideoPaneProps) {
  const sortedNotes = [...props.notes].sort((a, b) => a.time - b.time)

  return (
    <section className="dashboard-video-pane">
      <div className="dashboard-video-meta">
        <span>{props.speaker}</span>
        <span />
        <span>{props.sourceLine ?? SOURCE_LINE}</span>
      </div>
      <h1>{props.title}</h1>
      <VideoFrame
        containerRef={props.containerRef}
        ready={props.ready}
        hasVideo={props.hasVideo}
      />
      <div className="dashboard-saved-header">
        <span>ХАДГАЛСАН АГШИН</span>
        <span />
        <span>{sortedNotes.length} тэмдэглэгээ</span>
      </div>
    </section>
  )
}

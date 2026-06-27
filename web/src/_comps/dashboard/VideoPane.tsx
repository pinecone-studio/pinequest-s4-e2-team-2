"use client"

import type { RefObject } from "react"
import { SOURCE_LINE, type Note } from "./data"
import { VideoFrame } from "./VideoFrame"
import type { DubStep } from "./useDubAudio"

type VideoPaneProps = {
  containerRef: RefObject<HTMLDivElement | null>
  ready: boolean
  notes: Note[]
  hasVideo: boolean
  title: string
  speaker: string
  sourceLine?: string
  dubMode?: "mongolian" | "original"
  dubStatus?: DubStep
  dubProgress?: { done: number; total: number } | null
  dubError?: string | null
  voiceGender?: "male" | "female"
  onToggleDub?: () => void
  onToggleGender?: () => void
}

function statusText(status: DubStep | undefined, progress: { done: number; total: number } | null | undefined): string {
  if (!status) return ""
  if (status === "translating") {
    return progress ? `OpenAI орчуулж байна... ${progress.done}/${progress.total}` : "OpenAI орчуулж байна..."
  }
  if (status === "tts") {
    return progress ? `Azure TTS дуб үүсгэж байна... ${progress.done}/${progress.total}` : "Azure TTS дуб үүсгэж байна..."
  }
  if (status === "ready") return "✓ Монгол дуб бэлэн болсон"
  return ""
}

export function VideoPane(props: VideoPaneProps) {
  const sortedNotes = [...props.notes].sort((a, b) => a.time - b.time)
  const isLoading = props.dubStatus === "translating" || props.dubStatus === "tts"
  const isMongolian = props.dubMode === "mongolian"
  const dubStatusText = statusText(props.dubStatus, props.dubProgress)

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
      {props.hasVideo && props.onToggleDub && (
        <div className="dashboard-dub-toggle">
          <div className="dashboard-dub-buttons">
            <button
              onClick={props.onToggleDub}
              disabled={isLoading}
              className={`dashboard-dub-btn${isMongolian ? " active" : ""}`}
            >
              {isLoading
                ? "Бэлдэж байна..."
                : isMongolian
                ? "🔊 Монгол дуб"
                : "▶ Эх бичлэг"}
            </button>

            {isMongolian && props.onToggleGender && (
              <button
                onClick={props.onToggleGender}
                disabled={isLoading}
                className="dashboard-dub-btn"
                title="Хоолой солих"
              >
                {props.voiceGender === "male" ? "♂ Эрэгтэй" : "♀ Эмэгтэй"}
              </button>
            )}
          </div>

          {isLoading && props.dubProgress && props.dubProgress.total > 0 && (
            <div className="dashboard-dub-progress">
              <div className="dashboard-dub-progress-track">
                <div
                  className="dashboard-dub-progress-fill"
                  style={{ width: `${Math.round((props.dubProgress.done / props.dubProgress.total) * 100)}%` }}
                />
              </div>
              <span className="dashboard-dub-status">{dubStatusText}</span>
            </div>
          )}

          {!isLoading && dubStatusText && (
            <span className="dashboard-dub-status">{dubStatusText}</span>
          )}

          {props.dubError && (
            <span className="dashboard-dub-error">{props.dubError}</span>
          )}
        </div>
      )}
      <div className="dashboard-saved-header">
        <span>ХАДГАЛСАН АГШИН</span>
        <span />
        <span>{sortedNotes.length} тэмдэглэгээ</span>
      </div>
    </section>
  )
}

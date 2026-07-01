"use client"

import type { ReactNode, RefObject } from "react"
import { SOURCE_LINE, type Note } from "./data"
import { VideoFrame } from "./VideoFrame"
import type { DubStep } from "./useDubAudio"

// CHANGED: staged status for the "process" loadbar overlay on the video frame.
export type ProcessStage =
  | "idle"
  | "fetching"
  | "translating"
  | "dubbing"
  | "ready"
  | "error"

type VideoPaneProps = {
  containerRef: RefObject<HTMLDivElement | null>
  ready: boolean
  notes: Note[]
  hasVideo: boolean
  title: string
  speaker: string
  sourceLine?: string
  subtitle?: ReactNode
  dubMode?: "mongolian" | "original"
  dubStatus?: DubStep
  dubProgress?: { done: number; total: number } | null
  dubError?: string | null
  voiceGender?: "male" | "female"
  onToggleDub?: () => void
  onToggleGender?: () => void
  // CHANGED: process overlay inputs (stage + 0–1 progress, null = indeterminate)
  processStage?: ProcessStage
  processProgress?: number | null
}

// CHANGED: human-readable label for each process stage.
function processLabel(stage: ProcessStage | undefined): string {
  switch (stage) {
    case "fetching":
      return "Түр хүлээнэ үү... текст татаж байна (Fetching data...)"
    case "translating":
      return "Орчуулж байна... (Translating)"
    case "dubbing":
      return "Монгол дуу оруулж байна... (Vocalizing)"
    case "error":
      return "Алдаа гарлаа (Something went wrong)"
    default:
      return ""
  }
}

function statusText(status: DubStep | undefined, progress: { done: number; total: number } | null | undefined): string {
  if (!status) return ""
  if (status === "fetching") return "Caption татаж байна..."
  if (status === "translating") {
    return progress ? `OpenAI орчуулж байна... ${progress.done}/${progress.total}` : "OpenAI орчуулж байна..."
  }
  if (status === "tts") {
    return progress ? `Монгол хоолой үүсгэж байна... ${progress.done}/${progress.total}` : "Монгол хоолой үүсгэж байна..."
  }
  if (status === "ready") return "✓ Монгол дуб бэлэн болсон"
  return ""
}

export function VideoPane(props: VideoPaneProps) {
  const sortedNotes = [...props.notes].sort((a, b) => a.time - b.time)
  const isLoading = props.dubStatus === "fetching" || props.dubStatus === "translating" || props.dubStatus === "tts"
  const isMongolian = props.dubMode === "mongolian"
  const dubStatusText = statusText(props.dubStatus, props.dubProgress)
  // CHANGED: show the process overlay while the pipeline is working.
  const showProcess =
    props.processStage === "fetching" ||
    props.processStage === "translating" ||
    props.processStage === "dubbing" ||
    props.processStage === "error"

  return (
    <section className="dashboard-video-pane">
      <div className="dashboard-video-meta">
        <span>{props.speaker}</span>
        <span />
        <span>{props.sourceLine ?? SOURCE_LINE}</span>
      </div>
      <h1>{props.title}</h1>
      {/* CHANGED: relative wrapper so the process overlay can sit over the frame */}
      <div style={{ position: "relative" }}>
        <VideoFrame
          containerRef={props.containerRef}
          ready={props.ready}
          hasVideo={props.hasVideo}
        />
        {/* CHANGED: staged "process" loadbar overlay (fetch → translate → dub) */}
        {showProcess && (
          <div className="dashboard-process-overlay">
            <span className="dashboard-process-label">
              {processLabel(props.processStage)}
            </span>
            <div className="dashboard-process-track">
              <div
                className={`dashboard-process-fill${
                  props.processProgress == null ? " is-indeterminate" : ""
                }`}
                style={
                  props.processProgress == null
                    ? undefined
                    : { width: `${Math.round(props.processProgress * 100)}%` }
                }
              />
            </div>
          </div>
        )}
      </div>
      {props.subtitle}
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

          {isLoading && props.dubProgress != null && props.dubProgress.total > 0 && (() => {
            const dp = props.dubProgress!
            return (
              <div className="dashboard-dub-progress">
                <div className="dashboard-dub-progress-track">
                  <div
                    className="dashboard-dub-progress-fill"
                    style={{ width: `${Math.round((dp.done / dp.total) * 100)}%` }}
                  />
                </div>
                <span className="dashboard-dub-status">{dubStatusText}</span>
              </div>
            )
          })()}

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

"use client"

import React, { type ReactNode, type RefObject } from "react"
import { SOURCE_LINE, type Note } from "./data"
import { VideoFrame } from "./VideoFrame"
import type { DubStep } from "./useDubAudio"
import type { Voice } from "./voices"

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
  dubAvailable?: boolean
  voices?: Voice[]
  selectedVoiceId?: string
  dubVolume?: number
  ytVolume?: number
  onToggleDub?: () => void
  onSelectVoice?: (voiceId: string) => void
  onDubVolumeChange?: (v: number) => void
  onYtVolumeChange?: (v: number) => void
  quality?: string
  availableQualities?: string[]
  ccEnabled?: boolean
  onSetQuality?: (q: string) => void
  onToggleCC?: () => void
  processStage?: ProcessStage
  processProgress?: number | null
}

function processLabel(stage: ProcessStage | undefined): string {
  switch (stage) {
    case "fetching":     return "Текст татаж байна..."
    case "translating":  return "Орчуулж байна..."
    case "dubbing":      return "Монгол дуу үүсгэж байна..."
    case "error":        return "Алдаа гарлаа"
    default:             return ""
  }
}

function dubBtnLabel(status: DubStep | undefined): string {
  if (status === "translating") return "Орчуулж байна"
  if (status === "tts")         return "Дуб үүсгэж байна"
  if (status === "fetching")    return "Бэлдэж байна"
  if (status === "error")       return "Алдаа гарлаа"
  return "Монгол аудио орчуулга"
}

function VolumeRow({
  label, value, max = 100, onChange, disabled,
}: {
  label: string; value: number; max?: number
  onChange: (v: number) => void; disabled?: boolean
}) {
  const pct = Math.round((value / max) * 100)
  return (
    <div className="dub-vol-row">
      <span className="dub-vol-label">{label}</span>
      <input
        type="range" min={0} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="dub-vol-slider"
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
      />
      <span className="dub-vol-value">{value}</span>
    </div>
  )
}

export function VideoPane(props: VideoPaneProps) {
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  const sortedNotes = [...props.notes].sort((a, b) => a.time - b.time)
  const isLoading = props.dubStatus === "fetching" || props.dubStatus === "translating" || props.dubStatus === "tts"
  // While the video is being processed (captions → translate → dub), the dub
  // toggle is temporarily disabled — you can only flip it once things settle.
  const isProcessing =
    props.processStage === "fetching" ||
    props.processStage === "translating" ||
    props.processStage === "dubbing"
  const isError = props.dubStatus === "error"
  const isMongolian = props.dubMode === "mongolian"
  const showProcess =
    props.processStage === "fetching" ||
    props.processStage === "translating" ||
    props.processStage === "dubbing" ||
    props.processStage === "error"

  const hasDubSettings =
    (isMongolian || isLoading) &&
    (
      !!(props.voices && props.onSelectVoice) ||
      !!(props.onDubVolumeChange && props.onYtVolumeChange)
    )

  const hasAnySettings = props.hasVideo && hasDubSettings

  return (
    <section className="dashboard-video-pane">
      <div className="dashboard-video-meta">
        <span>{props.speaker}</span>
        <span />
        <span>{props.sourceLine ?? SOURCE_LINE}</span>
      </div>
      <h1>{props.title}</h1>
      <div style={{ position: "relative" }}>
        <VideoFrame
          containerRef={props.containerRef}
          ready={props.ready}
          hasVideo={props.hasVideo}
        />
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
        <div className="dub-panel">
          <div className="dub-panel-row">
            <button
              onClick={props.onToggleDub}
              disabled={isLoading || isProcessing || props.dubAvailable === false}
              className={[
                "dub-main-btn",
                isMongolian && !isError ? "is-active" : "",
                isLoading ? "is-loading" : "",
                isError ? "is-error" : "",
              ].filter(Boolean).join(" ")}
            >
              {isLoading
                ? <span className="dub-spinner" aria-hidden />
                : <span className={`dub-dot${isMongolian && !isError ? " is-lit" : ""}${isError ? " is-err" : ""}`} aria-hidden />}
              <span>{dubBtnLabel(props.dubStatus)}</span>
            </button>

            {hasAnySettings && (
              <button
                onClick={() => setSettingsOpen((o) => !o)}
                className={`settings-gear-btn${settingsOpen ? " is-open" : ""}`}
                title="Тохиргоо"
                aria-expanded={settingsOpen}
              >
                ⚙
              </button>
            )}
          </div>

          {settingsOpen && (
            <div className="settings-panel">

              {hasDubSettings && (
                <>
                  {props.voices && props.onSelectVoice && (
                    <div className="settings-section">
                      <span className="settings-section-label">ХООЛОЙ</span>
                      <div className="dub-voice-picker" role="group" aria-label="Хоолой сонгох">
                        {props.voices.map((v) => (
                          <button
                            key={v.id}
                            onClick={props.selectedVoiceId !== v.id ? () => props.onSelectVoice!(v.id) : undefined}
                            disabled={isLoading}
                            className={`dub-voice-card${props.selectedVoiceId === v.id ? " is-selected" : ""}`}
                          >
                            <span className="dub-voice-name">{v.name}</span>
                            <span className="dub-voice-gender">{v.gender === "male" ? "♂" : "♀"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {props.onDubVolumeChange && props.onYtVolumeChange && (
                    <div className="settings-section">
                      <span className="settings-section-label">ДУУН ХЭМЖЭЭ</span>
                      <div className="dub-vol-section">
                        <VolumeRow
                          label="Монгол дуб"
                          value={props.dubVolume ?? 100}
                          onChange={props.onDubVolumeChange}
                          disabled={isLoading}
                        />
                        <VolumeRow
                          label="Эх бичлэг"
                          value={props.ytVolume ?? 20}
                          max={50}
                          onChange={props.onYtVolumeChange}
                          disabled={isLoading}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {isLoading && (
            <div className="dub-progress-row">
              <div className="dub-progress-track">
                {props.dubProgress != null && props.dubProgress.total > 0 ? (
                  <div
                    className="dub-progress-fill"
                    style={{ width: `${Math.round((props.dubProgress.done / props.dubProgress.total) * 100)}%` }}
                  />
                ) : (
                  <div className="dub-progress-fill is-indeterminate" />
                )}
              </div>
              {props.dubProgress != null && props.dubProgress.total > 0 && (
                <span className="dub-count">
                  {props.dubProgress.done}/{props.dubProgress.total}
                </span>
              )}
            </div>
          )}

          {props.dubStatus === "ready" && (
            <p className="dub-ready-text">Аудио орчуулга бэлэн</p>
          )}

          {props.dubError && (
            <p className="dub-error-text">{props.dubError}</p>
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

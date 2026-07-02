"use client"

import React, { type ReactNode, type RefObject } from "react"
import { Settings, CheckCircle2, Maximize2, Minimize2, ChevronRight, ChevronLeft, Check } from "lucide-react"
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
  dubSpeed?: number
  onDubSpeedChange?: (v: number) => void
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

// Volume row with a typeable integer value. Behaves like SpeedRow — user can
// drag the slider or click the number to type an exact value in [0, max].
function VolumeRow({
  label, value, max = 100, onChange, disabled,
}: {
  label: string; value: number; max?: number
  onChange: (v: number) => void; disabled?: boolean
}) {
  const pct = Math.round((value / max) * 100)
  const [inputText, setInputText] = React.useState(String(value))
  const [editing, setEditing] = React.useState(false)

  React.useEffect(() => {
    if (!editing) setInputText(String(value))
  }, [value, editing])

  const commit = () => {
    setEditing(false)
    const parsed = parseInt(inputText, 10)
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(0, Math.min(max, parsed))
      onChange(clamped)
      setInputText(String(clamped))
    } else {
      setInputText(String(value))
    }
  }

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
      <span className="dub-speed-value">
        <input
          type="text"
          inputMode="numeric"
          className="dub-speed-input"
          value={inputText}
          onFocus={(e) => { setEditing(true); e.currentTarget.select() }}
          onChange={(e) => setInputText(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
            else if (e.key === "Escape") {
              setInputText(String(value))
              setEditing(false)
              e.currentTarget.blur()
            }
          }}
          disabled={disabled}
          aria-label={label}
        />
      </span>
    </div>
  )
}

// Speed row uses fixed 0.5x–2x range with 0.05 step. The value display is a
// text input so the user can type an exact speed (e.g. 1.25) instead of
// dragging — it clamps to the range on commit (Enter/blur).
function SpeedRow({
  label, value, onChange, disabled,
}: {
  label: string; value: number
  onChange: (v: number) => void; disabled?: boolean
}) {
  const min = 0.5
  const max = 2.0
  const pct = Math.round(((value - min) / (max - min)) * 100)
  const [inputText, setInputText] = React.useState(value.toFixed(2))
  const [editing, setEditing] = React.useState(false)

  // Keep the input in sync with slider drags — but only while the user isn't
  // actively typing, otherwise we'd fight their cursor mid-edit.
  React.useEffect(() => {
    if (!editing) setInputText(value.toFixed(2))
  }, [value, editing])

  const commit = () => {
    setEditing(false)
    const parsed = Number(inputText)
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed))
      onChange(clamped)
      setInputText(clamped.toFixed(2))
    } else {
      setInputText(value.toFixed(2))
    }
  }

  return (
    <div className="dub-vol-row">
      <span className="dub-vol-label">{label}</span>
      <input
        type="range" min={min} max={max} step={0.05} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="dub-vol-slider"
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
      />
      <span className="dub-speed-value">
        <input
          type="text"
          inputMode="decimal"
          className="dub-speed-input"
          value={inputText}
          onFocus={(e) => { setEditing(true); e.currentTarget.select() }}
          onChange={(e) => setInputText(e.target.value.replace(/[^0-9.]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
            else if (e.key === "Escape") {
              setInputText(value.toFixed(2))
              setEditing(false)
              e.currentTarget.blur()
            }
          }}
          disabled={disabled}
          aria-label={label}
        />
        <span className="dub-speed-suffix">x</span>
      </span>
    </div>
  )
}

export function VideoPane(props: VideoPaneProps) {
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  // YouTube-style drill-down: the voice row opens a submenu INSIDE the same
  // settings-panel instead of expanding inline. Only the voice section works
  // this way — volume/speed stay inline, unchanged. Reset alongside the gear
  // toggle (not a separate effect) so closing settings always lands back on
  // the top-level list next time it opens.
  const [voiceMenuOpen, setVoiceMenuOpen] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const videoWrapperRef = React.useRef<HTMLDivElement | null>(null)

  // Fullscreen the video wrapper (which contains BOTH the iframe and the
  // subtitle overlay) so the subtitle stays visible in fullscreen.
  const toggleFullscreen = React.useCallback(() => {
    const el = videoWrapperRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void el.requestFullscreen().catch(() => {})
    }
  }, [])

  React.useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

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
      !!(props.onDubVolumeChange && props.onYtVolumeChange) ||
      !!props.onDubSpeedChange
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
      <div
        ref={videoWrapperRef}
        className={`dashboard-video-wrapper${isFullscreen ? " is-fullscreen" : ""}`}
      >
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
        {props.subtitle && (
          <div className="dashboard-subtitle-overlay">{props.subtitle}</div>
        )}
        {props.hasVideo && (
          <button
            type="button"
            onClick={toggleFullscreen}
            className="dashboard-fs-btn"
            title={isFullscreen ? "Гарах" : "Дэлгэц дүүрэн"}
            aria-label={isFullscreen ? "Fullscreen-ээс гарах" : "Fullscreen"}
          >
            {isFullscreen
              ? <Minimize2 size={18} strokeWidth={2} aria-hidden />
              : <Maximize2 size={18} strokeWidth={2} aria-hidden />}
          </button>
        )}
      </div>
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
              <div className="settings-container">
                <button
                  onClick={() => setSettingsOpen((o) => { if (o) setVoiceMenuOpen(false); return !o })}
                  className={`settings-gear-btn${settingsOpen ? " is-open" : ""}`}
                  title="Тохиргоо"
                  aria-expanded={settingsOpen}
                  aria-label="Тохиргоо"
                >
                  <Settings size={16} strokeWidth={2} aria-hidden />
                  <span className="settings-gear-label">Тохиргоо</span>
                </button>

                {settingsOpen && (
                  <div className="settings-panel">
                    {/* YouTube-style: selecting "ХООЛОЙ" drills into a submenu
                        that replaces the panel content; a back row returns to
                        the top-level list. Volume/speed stay inline below. */}
                    {voiceMenuOpen && props.voices && props.onSelectVoice ? (
                      <div className="settings-section">
                        <button
                          type="button"
                          className="settings-back-row"
                          onClick={() => setVoiceMenuOpen(false)}
                        >
                          <ChevronLeft size={14} strokeWidth={2.5} aria-hidden />
                          <span className="settings-section-label">ХООЛОЙ</span>
                        </button>
                        <div className="dub-voice-picker" role="group" aria-label="Хоолой сонгох">
                          {props.voices.map((v) => (
                            <button
                              key={v.id}
                              onClick={
                                props.selectedVoiceId !== v.id
                                  ? () => { props.onSelectVoice!(v.id); setVoiceMenuOpen(false) }
                                  : () => setVoiceMenuOpen(false)
                              }
                              disabled={isLoading}
                              className={`dub-voice-card${props.selectedVoiceId === v.id ? " is-selected" : ""}`}
                              aria-pressed={props.selectedVoiceId === v.id}
                            >
                              <span className="dub-voice-check" aria-hidden>
                                {props.selectedVoiceId === v.id && <Check size={14} strokeWidth={3} />}
                              </span>
                              <span className="dub-voice-gender" aria-hidden>{v.gender === "male" ? "♂" : "♀"}</span>
                              <span className="dub-voice-name">{v.name}</span>
                              <span className="dub-voice-provider">{v.provider === "f5" ? "F5" : "Azure"}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : hasDubSettings && (
                      <>
                        {props.voices && props.onSelectVoice && (
                          <div className="settings-section">
                            <button
                              type="button"
                              className="settings-menu-row"
                              onClick={() => setVoiceMenuOpen(true)}
                              disabled={isLoading}
                            >
                              <span className="settings-section-label">ХООЛОЙ</span>
                              <span className="settings-menu-row-value">
                                {props.voices.find((v) => v.id === props.selectedVoiceId)?.name ?? ""}
                                <ChevronRight size={14} strokeWidth={2.5} aria-hidden />
                              </span>
                            </button>
                          </div>
                        )}

                        {props.onDubVolumeChange && props.onYtVolumeChange && (
                          <div className="settings-section">
                            <span className="settings-section-label">ДУУНЫ ХЭМЖЭЭ</span>
                            <div className="dub-vol-section">
                              <VolumeRow
                                label="Монгол аудио"
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

                        {props.onDubSpeedChange && (
                          <div className="settings-section">
                            <span className="settings-section-label">ХУРД</span>
                            <div className="dub-vol-section">
                              <SpeedRow
                                label="Хоолойны хурд"
                                value={props.dubSpeed ?? 1}
                                onChange={props.onDubSpeedChange}
                                disabled={isLoading}
                              />
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {isLoading && (() => {
            // Show 0–100 % if we have a real count, else indeterminate slider.
            const hasCount =
              props.dubProgress != null && props.dubProgress.total > 0
            const pct = hasCount
              ? Math.min(
                  100,
                  Math.round(
                    (props.dubProgress!.done / props.dubProgress!.total) * 100,
                  ),
                )
              : null
            return (
              <div className="dub-progress-row">
                <div className="dub-progress-track">
                  {pct != null ? (
                    <div className="dub-progress-fill" style={{ width: `${pct}%` }} />
                  ) : (
                    <div className="dub-progress-fill is-indeterminate" />
                  )}
                </div>
                <span className="dub-count">
                  {pct != null ? `${pct}%` : "0%"}
                </span>
              </div>
            )
          })()}

          {props.dubStatus === "ready" && (
            <p className="dub-ready-text">
              <CheckCircle2 size={16} strokeWidth={2.5} aria-hidden />
              <span>Аудио орчуулга бэлэн</span>
            </p>
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

"use client"

import { fmtTime } from "./time"

type NoteEditorProps = {
  draft: string
  currentTime: number
  onDraftChange: (value: string) => void
  onAddNote: () => void
}

export function NoteEditor({ draft, currentTime, onDraftChange, onAddNote }: NoteEditorProps) {
  return (
    <div style={{ flex: "none", padding: "16px 32px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span className="dashboard-note-time">{fmtTime(currentTime)}</span>
        <span className="dashboard-note-hint">энэ агшинд</span>
      </div>
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onAddNote()
        }}
        rows={2}
        placeholder="Бодлоо чөлөөтэй бичээрэй..."
        className="dashboard-note-textarea"
      />
      <div className="dashboard-note-actions" style={{ justifyContent: "flex-end" }}>
        <button onClick={onAddNote} className="dashboard-save-button">
          Хадгалах
        </button>
      </div>
    </div>
  )
}

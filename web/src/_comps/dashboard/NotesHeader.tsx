"use client"

import { PanelRightClose } from "lucide-react"

type NotesHeaderProps = {
  count: number
  mode: "write" | "review"
  onSetMode: (mode: "write" | "review") => void
  onOpenSummary: () => void
  onCollapse: () => void
}

export function NotesHeader({ count, mode, onSetMode, onOpenSummary, onCollapse }: NotesHeaderProps) {
  const isWrite = mode === "write"

  return (
    <div style={{ flex: "none", padding: "22px 32px 0" }}>
      <div className="dashboard-notes-title-row">
        <div style={{ display: "flex", alignItems: "baseline", gap: 13 }}>
          <span className="dashboard-notes-title">Notes</span>
          <span className="dashboard-notes-count">{count} moments</span>
        </div>
        <div className="dashboard-notes-actions">
          <button onClick={onOpenSummary} className="dashboard-ask-button">
            <span aria-hidden="true" />
            Ask
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="dashboard-notes-icon-button"
            aria-label="Collapse notes"
            title="Collapse notes"
          >
            <PanelRightClose size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="dashboard-notes-tabs">
        <button onClick={() => onSetMode("write")} className={isWrite ? "is-active" : ""}>
          Write
        </button>
        <button onClick={() => onSetMode("review")} className={!isWrite ? "is-active" : ""}>
          Review
        </button>
      </div>
    </div>
  )
}

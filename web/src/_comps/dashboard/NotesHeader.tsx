"use client"

import { Bot, NotebookPen, PanelRightClose } from "lucide-react"

type NotesHeaderProps = {
  count: number
  onOpenAssistant: () => void
  onCollapse: () => void
}

export function NotesHeader({ count, onOpenAssistant, onCollapse }: NotesHeaderProps) {
  return (
    <div className="dashboard-notes-header">
      <div className="dashboard-notes-title-row">
        <div className="dashboard-notes-title-brand">
          <span className="dashboard-notes-avatar" aria-hidden="true">
            <NotebookPen size={18} />
          </span>
          <div>
            <span className="dashboard-notes-title">Notes</span>
            <span className="dashboard-notes-count">{count} moments</span>
          </div>
        </div>
        <div className="dashboard-notes-actions">
          <div className="dashboard-panel-toggle" aria-label="Right panel view">
            <button type="button" className="is-active" aria-pressed="true">
              <NotebookPen size={14} aria-hidden="true" />
              <span>Notes</span>
            </button>
            <button type="button" onClick={onOpenAssistant} aria-pressed="false">
              <Bot size={14} aria-hidden="true" />
              <span>AI Assistant</span>
            </button>
          </div>
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
    </div>
  )
}

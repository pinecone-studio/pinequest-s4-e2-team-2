"use client"

import { useState } from "react"
import type { Note } from "./data"
import { NoteEditor } from "./NoteEditor"
import { NoteList } from "./NoteList"
import { NotesHeader } from "./NotesHeader"

type NotesPaneProps = {
  notes: Note[]
  draft: string
  justAdded: string | null
  onDraftChange: (value: string) => void
  onAddNote: () => void
  onJump: (time: number) => void
  onOpenAssistant: () => void
  onCollapse: () => void
}

export function NotesPane({
  notes,
  draft,
  justAdded,
  onDraftChange,
  onAddNote,
  onJump,
  onOpenAssistant,
  onCollapse,
}: NotesPaneProps) {
  const sorted = [...notes].sort((a, b) => a.time - b.time)
  const [isPressing, setIsPressing] = useState(false)

  return (
    <div
      className={isPressing ? "dashboard-notes-pane is-pressing" : "dashboard-notes-pane"}
      onPointerDown={() => setIsPressing(true)}
      onPointerUp={() => setIsPressing(false)}
      onPointerCancel={() => setIsPressing(false)}
      onPointerLeave={() => setIsPressing(false)}
    >
      <div className="dashboard-paper" />
      <div className="dashboard-paper-light" />
      <div className="dashboard-notes-content">
        <NotesHeader
          count={sorted.length}
          onOpenAssistant={onOpenAssistant}
          onCollapse={onCollapse}
        />
        <div className="dashboard-scroll dashboard-notes-scroll">
          <div className="dashboard-notes-list-wrap">
            <NoteList notes={sorted} justAdded={justAdded} onJump={onJump} />
          </div>
        </div>
        <NoteEditor draft={draft} onDraftChange={onDraftChange} onAddNote={onAddNote} />
      </div>
    </div>
  )
}

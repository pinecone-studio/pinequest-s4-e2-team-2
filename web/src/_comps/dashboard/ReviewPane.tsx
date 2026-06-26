"use client"

import type { Note } from "./data"
import { fmtTime } from "./time"

type ReviewPaneProps = {
  notes: Note[]
  onJump: (time: number) => void
}

export function ReviewPane({ notes, onJump }: ReviewPaneProps) {
  return (
    <div style={{ padding: "22px 34px 44px" }}>
      <div className="dashboard-review-title">Хичээлийн дүгнэлт</div>
      <div className="dashboard-review-count">{notes.length} тэмдэглэл</div>
      {notes.map((note) => (
        <button key={note.id} onClick={() => onJump(note.time)} className="dashboard-review-row">
          <span>{fmtTime(note.time)}</span>
          <span>{note.text}</span>
        </button>
      ))}
    </div>
  )
}

"use client"

import type { Note } from "./data"
import { fmtTime } from "./time"

type NoteListProps = {
  notes: Note[]
  justAdded: string | null
  onJump: (time: number) => void
}

export function NoteList({ notes, justAdded, onJump }: NoteListProps) {
  if (notes.length === 0) {
    return (
      <div className="dashboard-empty-notes">
        Одоохондоо хоосон байна. Видеогоо үзэж яваад зүрхэнд чинь хүрсэн мөчид бодлоо тэмдэглээрэй.
      </div>
    )
  }

  return (
    <>
      {notes.map((note) => (
        <button
          key={note.id}
          onClick={() => onJump(note.time)}
          className={justAdded === note.id ? "dashboard-note-row is-new" : "dashboard-note-row"}
        >
          <span className="dashboard-note-row-time">{fmtTime(note.time)}</span>
          <span className="dashboard-note-row-text">{note.text}</span>
        </button>
      ))}
    </>
  )
}

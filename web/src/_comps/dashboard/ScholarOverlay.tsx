"use client"

import { ScholarMessage } from "./ScholarMessage"
import { ScholarPortrait } from "./ScholarPortrait"

type ScholarOverlayProps = {
  open: boolean
  reply: string
  onClose: () => void
}

export function ScholarOverlay({ open, reply, onClose }: ScholarOverlayProps) {
  if (!open) return null

  return (
    <div className="dashboard-scholar-overlay">
      <div className="dashboard-scholar-shade" />
      <ScholarPortrait />
      <ScholarMessage reply={reply} />
      <button onClick={onClose} aria-label="Хаах" className="dashboard-close-scholar">
        Хаах x
      </button>
    </div>
  )
}

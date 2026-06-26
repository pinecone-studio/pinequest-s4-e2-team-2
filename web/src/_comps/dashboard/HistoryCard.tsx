"use client"

import { thumb, type HistoryItem } from "./data"

type HistoryCardProps = {
  item: HistoryItem
  active: boolean
  onSelect: (item: HistoryItem) => void
}

export function HistoryCard({ item, active, onSelect }: HistoryCardProps) {
  const thumbnailUrl = item.thumbnailUrl || thumb(item.id)

  return (
    <button
      onClick={() => onSelect(item)}
      className={active ? "dashboard-history-card is-active" : "dashboard-history-card"}
    >
      <div className="dashboard-history-thumb">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbnailUrl || "/placeholder.svg"} alt={item.title} crossOrigin="anonymous" />
        <div className="dashboard-history-progress">
          <div style={{ width: `${item.progress * 100}%` }} />
        </div>
        {item.progress >= 1 && <div className="dashboard-history-seen">ҮЗСЭН</div>}
      </div>
      <div className="dashboard-history-title">{item.title}</div>
      <div className="dashboard-history-meta">
        <span>{item.speaker}</span>
        <span>{item.notes} тэмдэглэл</span>
      </div>
    </button>
  )
}

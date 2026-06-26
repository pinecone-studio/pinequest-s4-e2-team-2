"use client"

import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { type HistoryItem } from "./data"
import { HistoryCard } from "./HistoryCard"

type HistoryRailProps = {
  items: HistoryItem[]
  activeId: string
  loading?: boolean
  error?: string
  onSelect: (item: HistoryItem) => void
  onCollapse: () => void
}

export function HistoryRail({
  items,
  activeId,
  loading = false,
  error = "",
  onSelect,
  onCollapse,
}: HistoryRailProps) {
  return (
    <aside className="dashboard-history-rail">
      <div className="dashboard-section-label dashboard-history-label">
        <span>WATCH HISTORY</span>
        <span />
        <button
          type="button"
          onClick={onCollapse}
          className="dashboard-history-icon-button"
          aria-label="Collapse history"
          title="Collapse history"
        >
          <PanelLeftClose size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="dashboard-history-list dashboard-scroll">
        {loading && <div className="dashboard-empty-history">History loading...</div>}
        {!loading && error && <div className="dashboard-empty-history">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="dashboard-empty-history">
            Search and choose a YouTube video to start history.
          </div>
        )}
        {!loading && !error && items.map((item) => (
          <HistoryCard key={item.id} item={item} active={item.id === activeId} onSelect={onSelect} />
        ))}
      </div>
    </aside>
  )
}

export function CollapsedHistoryRail({ onOpen }: { onOpen: () => void }) {
  return (
    <aside className="dashboard-history-collapsed-rail">
      <button
        type="button"
        onClick={onOpen}
        className="dashboard-open-history-button"
        aria-label="Open history"
        title="Open history"
      >
        <PanelLeftOpen size={16} aria-hidden="true" />
        <span>History</span>
      </button>
    </aside>
  )
}

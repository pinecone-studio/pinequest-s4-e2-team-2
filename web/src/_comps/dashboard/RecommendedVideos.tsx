"use client"

import { PanelRightOpen } from "lucide-react"
import type { YouTubeVideoSearchResult } from "@/lib/youtube-search"

type RecommendedVideosProps = {
  items: YouTubeVideoSearchResult[]
  loading: boolean
  error: string
  onSelect: (item: YouTubeVideoSearchResult) => void
  onOpenNotes: () => void
}

export function RecommendedVideos({
  items,
  loading,
  error,
  onSelect,
  onOpenNotes,
}: RecommendedVideosProps) {
  return (
    <aside className="dashboard-recommendations-pane">
      <div className="dashboard-recommendations-top">
        <button
          type="button"
          onClick={onOpenNotes}
          className="dashboard-open-notes-button"
          aria-label="Open notes"
          title="Open notes"
        >
          <PanelRightOpen size={16} aria-hidden="true" />
          <span>Open notes</span>
        </button>
      </div>
      <div className="dashboard-section-label">
        <span>YOUTUBE RECOMMENDS</span>
        <span />
      </div>
      <div className="dashboard-recommendations-list dashboard-scroll">
        {loading ? (
          <div className="dashboard-empty-recommendations">Loading YouTube recommendations...</div>
        ) : error ? (
          <div className="dashboard-empty-recommendations">{error}</div>
        ) : items.length === 0 ? (
          <div className="dashboard-empty-recommendations">
            YouTube recommendations will appear after choosing a video.
          </div>
        ) : (
          items.map((item) => (
            <button
              type="button"
              key={item.id}
              className="dashboard-recommendation-card"
              onClick={() => onSelect(item)}
            >
              <div className="dashboard-recommendation-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.thumbnailUrl} alt={item.title} />
              </div>
              <div className="dashboard-recommendation-copy">
                <span>{item.title}</span>
                <small>
                  {[item.channelTitle, item.durationLabel, item.ago].filter(Boolean).join(" - ") ||
                    "YouTube video"}
                </small>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  )
}

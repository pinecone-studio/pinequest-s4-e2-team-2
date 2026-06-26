"use client"

import type { RefObject } from "react"

type VideoFrameProps = {
  containerRef: RefObject<HTMLDivElement | null>
  ready: boolean
  hasVideo: boolean
}

export function VideoFrame({
  containerRef,
  ready,
  hasVideo,
}: VideoFrameProps) {
  return (
    <div className="dashboard-video-frame">
      {hasVideo ? (
        <>
          <div ref={containerRef} className="dashboard-youtube-container" />
          {!ready && <div className="dashboard-video-loading">Loading...</div>}
        </>
      ) : (
        <div className="dashboard-empty-video">
          <span>SEARCH FIRST</span>
          <p>Search YouTube above, choose a video, and your real watch history will appear here.</p>
        </div>
      )}
    </div>
  )
}

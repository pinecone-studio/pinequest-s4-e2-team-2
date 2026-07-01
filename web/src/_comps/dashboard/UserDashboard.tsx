"use client";

// User dashboard. Deliberately SMALL: the video pane with the dub + subtitle
// features, plus ONE collapsible sidebar (YTsidebar) holding all five tabs —
// history, recommendations, notes, summary and AI. All user-data fetching lives
// in the providers (useUI / useVideoProcess); this component only composes them.

import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { useVideoProcess } from "@/_comps/providers/VideoProcessProvider";
import { VideoPane } from "@/_comps/dashboard/VideoPane";
import { SubtitlePane } from "@/_comps/dashboard/SubtitlePane";
import { YTsidebar } from "@/_comps/ui/YTsidebar";
import { AmbientBackground } from "./AmbientBackground";

export default function UserDashboard() {
  const {
    videoId,
    selectedVideo,
    player,
    subtitleSegments,
    processStage,
    processProgress,
    dubMode,
    toggleDub,
    voices,
    selectedVoiceId,
    selectVoice,
    dub,
    cancel,
  } = useVideoProcess();

  // Duck the original YouTube audio while the Mongolian dub is playing.
  useEffect(() => {
    if (!player.ready) return;
    player.unMute();
    player.setVolume(dubMode === "mongolian" ? 12 : 100);
  }, [dubMode, player.ready, videoId, player.unMute, player.setVolume]);

  const subLoading =
    processStage === "fetching" || processStage === "translating";
  const subError =
    processStage === "error" ? "Хадмал бэлдэхэд алдаа гарлаа" : "";

  return (
    <div className="min-h-screen w-full px-4 pb-12 pt-44">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <AmbientBackground />
          <button
            type="button"
            onClick={cancel}
            className="mb-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Буцах
          </button>
          <VideoPane
            containerRef={player.containerRef}
            ready={player.ready}
            notes={[]}
            hasVideo={Boolean(videoId)}
            title={selectedVideo?.title ?? "YouTube video"}
            speaker={selectedVideo?.channelTitle ?? ""}
            sourceLine={!videoId ? "NO VIDEO SELECTED" : undefined}
            subtitle={
              videoId ? (
                <SubtitlePane
                  segments={subtitleSegments}
                  currentTime={player.time}
                  loading={subLoading}
                  error={subError}
                />
              ) : null
            }
            dubMode={dubMode}
            dubStatus={dub.step}
            dubProgress={dub.progress}
            dubError={dub.error}
            onToggleDub={toggleDub}
            voices={voices}
            selectedVoiceId={selectedVoiceId}
            onSelectVoice={selectVoice}
            processStage={processStage}
            processProgress={processProgress}
          />
        </div>
        <YTsidebar />
      </div>
    </div>
  );
}

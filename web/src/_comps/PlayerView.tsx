"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX, RotateCcw, ChevronLeft, Languages } from "lucide-react";
import { Button } from "@/_comps/ui/Button";
import { useTranscriptLogger } from "@/_comps/youtube-transcript/useTranscriptLogger";
import { processVideo, type Segment } from "@/lib/backend-api";

type DisplaySegment = {
  start: number;
  end: number;
  original: string;
  mongolian: string;
  audio_path: string | null;
};

function toDisplaySegments(raw: Segment[]): DisplaySegment[] {
  return raw.map((s) => ({
    start: s.start,
    end: s.start + s.duration,
    original: s.text,
    mongolian: s.translated_text ?? s.text,
    audio_path: s.audio_path,
  }));
}

export default function PlayerView({
  videoUrl,
  onBack,
}: {
  videoUrl: string;
  onBack: () => void;
}) {
  const videoId = videoUrl.match(/(?:v=|youtu\.be\/)([^&\s]+)/)?.[1] ?? "";

  const [segments, setSegments] = useState<DisplaySegment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const duration = segments[segments.length - 1]?.end ?? 0;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSegmentIdx, setActiveSegmentIdx] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    if (!videoId) return;
    setIsLoading(true);
    setError(null);
    processVideo(videoId)
      .then((result) => setSegments(toDisplaySegments(result.segments)))
      .catch((err) => setError(err.message ?? "Алдаа гарлаа"))
      .finally(() => setIsLoading(false));
  }, [videoId]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef<HTMLDivElement | null>(null);

  useTranscriptLogger(videoId);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= duration) {
            setIsPlaying(false);
            return duration;
          }
          return prev + 0.25;
        });
      }, 250);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, duration]);

  useEffect(() => {
    const idx = segments.findIndex((s) => currentTime >= s.start && currentTime < s.end);
    if (idx !== -1 && idx !== activeSegmentIdx) {
      setActiveSegmentIdx(idx);
    }
  }, [currentTime, segments, activeSegmentIdx]);

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeSegmentIdx]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentTime(Number(e.target.value));
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const progressPct = (currentTime / duration) * 100;

  if (isLoading) {
    return (
      <div className="w-full max-w-5xl mx-auto px-4 flex flex-col items-center justify-center min-h-64 gap-3">
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">Видео боловсруулж байна...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-5xl mx-auto px-4 flex flex-col items-center justify-center min-h-64 gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          Буцах
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        Буцах
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-3">
          <div className="relative w-full rounded-2xl overflow-hidden bg-black aspect-video shadow-2xl">
            {videoId ? (
              <iframe
                src={`https://www.youtube.com/embed/${videoId}?autoplay=0&controls=1&modestbranding=1`}
                title="YouTube video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                <p className="text-white/50 text-sm">Видео ачааллаж байна...</p>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-card border border-border p-3 space-y-2">
            <div className="relative h-2 rounded-full bg-muted overflow-hidden cursor-pointer">
              <div
                className="absolute left-0 top-0 h-full bg-primary rounded-full transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
              <input
                type="range"
                min={0}
                max={duration}
                step={0.25}
                value={currentTime}
                onChange={handleSeek}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setCurrentTime(0)}>
                  <RotateCcw className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="w-9 h-9" onClick={() => setIsPlaying((p) => !p)}>
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setIsMuted((m) => !m)}>
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </Button>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowOriginal((p) => !p)}
            className="gap-2 text-xs"
          >
            <Languages className="w-3.5 h-3.5" />
            {showOriginal ? "Монгол харах" : "Эх хэлийг харах"}
          </Button>

        </div>

        <div className="lg:col-span-2 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <h3 className="text-sm font-semibold text-foreground">Монгол хадмал</h3>
          </div>

          <div
            className="flex-1 max-h-[420px] overflow-y-auto space-y-2 pr-1 scroll-smooth"
            style={{ scrollbarWidth: "thin" }}
          >
            {segments.map((seg, idx) => {
              const isActive = idx === activeSegmentIdx;
              const isPast = currentTime > seg.end;
              return (
                <div
                  key={idx}
                  ref={isActive ? activeRef : null}
                  onClick={() => setCurrentTime(seg.start)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all duration-300 ${
                    isActive
                      ? "border-primary bg-primary/10 shadow-sm"
                      : isPast
                      ? "border-border bg-card opacity-50"
                      : "border-border bg-card hover:border-primary/30 hover:bg-primary/5"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-xs font-mono ${isActive ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {formatTime(seg.start)}
                    </span>
                    {isActive && (
                      <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium">
                        Одоо
                      </span>
                    )}
                  </div>
                  <p
                    className={`text-sm leading-relaxed ${
                      isActive ? "text-foreground font-medium" : "text-muted-foreground"
                    }`}
                  >
                    {showOriginal ? seg.original : seg.mongolian}
                  </p>
                  {showOriginal && isActive && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{seg.mongolian}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

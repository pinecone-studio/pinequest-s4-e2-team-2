"use client";

// Test page: can OCR read YouTube captions off the screen instead of fetching
// them from YouTube (which keeps getting blocked)?
// Flow: user shares a screen/tab → we show it in a <video> → CaptionOCR reads
// a strip of each frame and reports any text it finds.

import { useEffect, useRef, useState } from "react";
import { CaptionOCR, DEFAULT_CROP } from "./_comps/CaptionOcr";
import { useScreenShare } from "./_comps/ScreenShareProvider";
import { CaptionAssembler, type Segment } from "./_comps/captionAssembler";

export default function TestDubPage() {
  const { stream, error, isSharing, requestShare, stopShare } =
    useScreenShare();

  // The <video> element that previews the shared screen.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Most recent raw text OCR pulled off the screen (shown for quick eyeballing).
  const [ocrText, setOcrText] = useState("");
  // Clean, de-duplicated, timed segments rebuilt from the noisy OCR stream.
  const [segments, setSegments] = useState<Segment[]>([]);
  // Merges overlapping OCR reads into one timestamped transcript (browser-side).
  const assemblerRef = useRef(new CaptionAssembler());
  // When sharing started, so each caption can be timestamped relative to it.
  const startRef = useRef<number | null>(null);

  // Feed the shared stream into the preview <video> whenever it changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => {});
  }, [stream]);

  // Mark when harvesting starts/stops so timestamps are relative to share start,
  // and clear the previous batch when a new share begins.
  useEffect(() => {
    if (isSharing) {
      startRef.current = performance.now();
      assemblerRef.current.reset();
      setSegments([]);
    } else {
      startRef.current = null;
    }
  }, [isSharing]);

  // Each raw OCR read is fed to the assembler, which strips the rolling-window
  // repetition and rebuilds clean timed segments. We log the recomputed batch —
  // this is the data that will be POSTed to the backend for translation + dub.
  const handleText = (text: string) => {
    setOcrText(text);
    const time =
      startRef.current === null
        ? 0
        : (performance.now() - startRef.current) / 1000;
    assemblerRef.current.add(text, time);
    const batch = assemblerRef.current.segments();
    setSegments(batch);
    console.log("[screengrab] clean segments", batch);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 space-y-4">
      <header>
        <h1 className="text-xl font-bold">Screen-grab OCR test</h1>
        <p className="text-sm text-zinc-400">
          Share the tab/window playing a video with captions on, then watch the
          OCR output below.
        </p>
      </header>

      {/* Screen permission button: toggles the share prompt on/off. */}
      <div className="flex gap-2">
        {!isSharing ? (
          <button
            onClick={requestShare}
            className="rounded bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-500"
          >
            Share screen
          </button>
        ) : (
          <button
            onClick={stopShare}
            className="rounded bg-red-600 px-4 py-2 font-semibold hover:bg-red-500"
          >
            Stop sharing
          </button>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Video player: previews whatever screen/tab the user shared.
          object-fill makes the frame map 1:1 to the element box, so the crop
          box below lines up with the region the OCR actually reads. */}
      <div className="relative w-full max-w-3xl">
        <video
          ref={videoRef}
          muted
          playsInline
          className="w-full rounded-lg border border-zinc-800 bg-black aspect-video object-fill"
        />
        {/* Debug guide: highlighted border showing the exact OCR crop region. */}
        {isSharing && (
          <div
            className="absolute border-2 border-lime-400/90 pointer-events-none"
            style={{
              left: `${DEFAULT_CROP.left * 100}%`,
              top: `${DEFAULT_CROP.top * 100}%`,
              width: `${DEFAULT_CROP.width * 100}%`,
              height: `${DEFAULT_CROP.height * 100}%`,
            }}
          />
        )}
      </div>

      {/* Latest OCR reading. */}
      <section className="max-w-3xl">
        <h2 className="text-sm text-zinc-400 mb-1">OCR output</h2>
        <div className="min-h-12 rounded bg-zinc-900 p-3 font-mono text-sm wrap-break-word">
          {ocrText || (
            <span className="text-zinc-600">
              {isSharing ? "Waiting for caption text…" : "Not sharing yet."}
            </span>
          )}
        </div>
      </section>

      {/* Harvested segments — the running batch (also logged to the console). */}
      <section className="max-w-3xl">
        <h2 className="text-sm text-zinc-400 mb-1">
          Harvested segments ({segments.length})
        </h2>
        <div className="max-h-64 overflow-auto rounded bg-zinc-900 p-3 font-mono text-xs space-y-1">
          {segments.length === 0 ? (
            <span className="text-zinc-600">No segments harvested yet.</span>
          ) : (
            segments.map((seg, i) => (
              <div key={i} className="wrap-break-word">
                <span className="text-zinc-500">
                  [{seg.start.toFixed(1)}s · {seg.duration.toFixed(1)}s]
                </span>{" "}
                {seg.text}
              </div>
            ))
          )}
        </div>
      </section>

      {/* OCR worker runs only while sharing; it has no UI of its own. */}
      {isSharing && <CaptionOCR onText={handleText} />}
    </main>
  );
}

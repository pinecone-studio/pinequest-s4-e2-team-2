"use client";
import { useEffect, useRef } from "react";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { useScreenShare } from "./ScreenShareProvider";

type Props = {
  onText: (text: string) => void;
  workers?: number; // how many OCR workers run in parallel
  minGapMS?: number; // min pause between a worker's passes (0 = full speed)
  lang?: string;
  cropTop?: number; // strip start, fraction of frame height
  cropHeight?: number; // strip height, fraction of frame height
  cropLeft?: number; // strip start, fraction of frame width
  cropWidth?: number; // strip width, fraction of frame width
  minConfidence?: number; // drop OCR words below this confidence (0-100)
};

// A single OCR word with its confidence score.
type OcrWord = { text: string; confidence: number };

// Tesseract v6+ returns words nested inside blocks→paragraphs→lines (the old
// flat data.words was removed). Flatten them back into one list, falling back
// to data.words if a future/older version still provides it.
function collectWords(data: {
  words?: OcrWord[];
  blocks?: unknown[] | null;
}): OcrWord[] {
  if (Array.isArray(data.words) && data.words.length) return data.words;
  const out: OcrWord[] = [];
  for (const block of (data.blocks ?? []) as any[])
    for (const para of block?.paragraphs ?? [])
      for (const line of para?.lines ?? [])
        for (const word of line?.words ?? [])
          out.push({ text: word.text, confidence: word.confidence });
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Default crop region (fractions of the frame). Exported so a preview can draw
// the exact same box over the video for visual verification.
export const DEFAULT_CROP = {
  top: 0.8,
  height: 0.22,
  left: 0.15,
  width: 0.8,
};

export function CaptionOCR({
  onText,
  workers = 1,
  minGapMS = 0,
  lang = "eng",
  cropTop = DEFAULT_CROP.top,
  cropHeight = DEFAULT_CROP.height,
  cropLeft = DEFAULT_CROP.left,
  cropWidth = DEFAULT_CROP.width,
  minConfidence = 60,
}: Props) {
  const { stream } = useScreenShare();

  // Latest onText + tuning values held in refs so the OCR loops always read the
  // current values WITHOUT being dependencies of the worker effect (which would
  // tear the pool down and rebuild it on every parent re-render).
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const cfgRef = useRef({
    cropTop,
    cropHeight,
    cropLeft,
    cropWidth,
    minConfidence,
    minGapMS,
  });
  cfgRef.current = {
    cropTop,
    cropHeight,
    cropLeft,
    cropWidth,
    minConfidence,
    minGapMS,
  };

  const lastTextRef = useRef("");

  // Pool lifecycle depends only on stream + language + worker count: build the
  // pool once, run all loops, tear down on stop/unmount.
  useEffect(() => {
    if (!stream) return;
    let cancelled = false;
    const video = document.createElement("video");
    const pool: Worker[] = [];

    // Ordered-emit gate. Each captured frame gets a sequence number; we only
    // emit a result whose sequence is newer than the last one emitted, so a
    // slow worker's stale result can't overwrite a newer caption.
    let captureSeq = 0;
    let lastEmittedSeq = -1;

    const terminateAll = () => {
      while (pool.length) pool.pop()?.terminate();
    };

    // One capture → binarize → OCR → (maybe) report pass. The worker is passed
    // in so an in-flight recognize never touches a worker that's been replaced.
    const grabOnce = async (worker: Worker) => {
      if (cancelled || !video.videoWidth) return;
      const cfg = cfgRef.current;

      const w = video.videoWidth;
      const h = video.videoHeight;

      // (3) Crop a shallow band in the lower-center where captions live.
      const stripY = Math.floor(h * cfg.cropTop);
      const stripH = Math.floor(h * cfg.cropHeight);
      const sx = Math.floor(w * cfg.cropLeft);
      const sw = Math.floor(w * cfg.cropWidth);

      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = stripH;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, sx, stripY, sw, stripH, 0, 0, sw, stripH);

      // (1) Binarize: bright white captions → black text on white background.
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const dd = img.data;
      for (let i = 0; i < dd.length; i += 4) {
        const lum = 0.299 * dd[i] + 0.587 * dd[i + 1] + 0.114 * dd[i + 2];
        const v = lum > 180 ? 0 : 255;
        dd[i] = dd[i + 1] = dd[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);

      // Capture order is fixed here (the moment we grabbed the frame).
      const seq = ++captureSeq;

      // Bail if torn down while building the frame, so we never call recognize
      // on a worker that's about to be / has been terminated.
      if (cancelled) return;
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      if (cancelled) return;

      // (5) Keep only high-confidence words; fall back to raw text if a version
      // doesn't surface word data.
      const words = collectWords(data);
      const text = (
        words.length
          ? words
              .filter((wd) => wd.confidence > cfg.minConfidence)
              .map((wd) => wd.text)
              .join(" ")
          : data.text
      )
        .replace(/\s+/g, " ")
        .trim();

      if (!text) return;
      // Drop results older than what we've already shown (out-of-order finish).
      if (seq <= lastEmittedSeq) return;
      lastEmittedSeq = seq;
      if (text === lastTextRef.current) return; // same caption, nothing new
      lastTextRef.current = text;
      onTextRef.current(text);
    };

    // Each worker reads continuously; running several offsets their sampling, so
    // the pool's effective sample rate is roughly (worker count) × single-worker.
    const runLoop = async (worker: Worker) => {
      while (!cancelled) {
        try {
          await grabOnce(worker);
        } catch (e) {
          if (!cancelled) console.log("OCR fail:", e);
        }
        if (cancelled) break;
        if (cfgRef.current.minGapMS > 0) await sleep(cfgRef.current.minGapMS);
      }
    };

    const setup = async () => {
      video.srcObject = stream;
      video.muted = true;
      // play() can reject with AbortError if cleanup pauses the element before it
      // resolves (e.g. React StrictMode's mount→unmount→remount). It's harmless.
      await video.play().catch(() => {});
      if (cancelled) return;

      const n = Math.max(1, Math.floor(workers));
      for (let i = 0; i < n && !cancelled; i++) {
        const worker = await createWorker(lang);
        // (2) PSM 6 = single uniform text block (captions are 1-2 lines).
        // (4) Whitelist the characters captions actually use.
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          tessedit_char_whitelist:
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?'\"-",
        });
        pool.push(worker);
      }

      if (cancelled) {
        terminateAll();
        return;
      }

      lastTextRef.current = "";
      lastEmittedSeq = -1;
      captureSeq = 0;
      for (const worker of pool) void runLoop(worker);
    };

    void setup();

    return () => {
      cancelled = true;
      video.pause();
      video.srcObject = null;
      terminateAll();
    };
  }, [stream, lang, workers]);

  return null;
}

import type { TranscriptSegment } from "@/lib/dub-job";

const MIN_WINDOW_SEC = 8;
const MAX_WINDOW_SEC = 12;
const SEARCH_START_FRACTION = 0.05; // skip likely intro (first 5% of the video)
const SEARCH_END_CAP_SEC = 120; // keep the reference-audio download small

// [Music], [Applause], (laughs), etc. — not real speech, unusable as a voice
// reference and useless as ref_text.
const NON_SPEECH = /^[[(].*[\])]$/;

export type RefWindow = { start: number; duration: number; text: string };

// Picks a contiguous run of real-speech transcript segments ~8-12s long to
// use as the F5 voice-cloning reference: clean, single-speaker, no bracketed
// sound-effect tags. Prefers a window a little into the video (skips cold-open
// jingles/logos) but stays within the first two minutes so the reference-audio
// download (lib/audio-ref.ts fetches byte 0 through the window's end) stays
// small. Returns null if no segment run in the transcript qualifies.
export function pickReferenceWindow(segments: TranscriptSegment[]): RefWindow | null {
  if (!segments.length) return null;

  const totalDuration = segments[segments.length - 1].start + segments[segments.length - 1].duration;
  const searchStart = Math.min(totalDuration * SEARCH_START_FRACTION, 20);
  const searchEnd = Math.min(totalDuration, SEARCH_END_CAP_SEC);

  const candidates = segments.filter(
    (s) => s.start >= searchStart && s.start < searchEnd && s.text.trim() && !NON_SPEECH.test(s.text.trim()),
  );
  if (!candidates.length) return null;

  let best: RefWindow | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const windowStart = candidates[i].start;
    let windowEnd = windowStart;
    const texts: string[] = [];
    for (let j = i; j < candidates.length; j++) {
      const seg = candidates[j];
      // A gap means the run of contiguous real speech ended.
      if (seg.start - windowEnd > 1.5) break;
      // Adding this segment would overshoot the max window — stop here,
      // whatever we've accumulated so far (if enough) is the answer.
      if (seg.start + seg.duration - windowStart > MAX_WINDOW_SEC) break;
      windowEnd = seg.start + seg.duration;
      texts.push(seg.text.trim());
      if (windowEnd - windowStart >= MIN_WINDOW_SEC) break;
    }
    const span = windowEnd - windowStart;
    if (span >= MIN_WINDOW_SEC) {
      best = { start: windowStart, duration: span, text: texts.join(" ") };
      break;
    }
  }

  return best;
}

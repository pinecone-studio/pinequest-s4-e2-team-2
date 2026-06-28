// Browser-side caption assembly.
//
// OCR of rolling YouTube captions produces lots of overlapping, repetitive
// reads of the SAME growing line, e.g.
//   "played out of George Washington you"
//   "played out of George Washington you know"
//   "played out of George Washington you know I"
// Sending that to the backend as-is would be noisy and duplicated. This module
// merges the stream into one continuously-built, de-duplicated transcript with
// per-word timestamps, then chunks it into clean, accurately-timed segments.
//
// Pure logic only (no DOM, no network) — runs wherever it's imported, which here
// is the client-side screengrab page, so all of this executes in the browser.

export type Segment = { start: number; duration: number; text: string };

type TimedWord = { raw: string; norm: string; time: number };

// Normalize for comparison: lowercase, strip surrounding punctuation. Keeps
// apostrophes/digits so "don't" and "2020" stay intact.
const normalize = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

type AssemblerOpts = {
  overlapWindow?: number; // how many trailing words to search for the overlap
  minOverlap?: number; // require at least this many overlapping words to trust it
  matchRatio?: number; // fraction of overlap words that must match (0-1)
};

export class CaptionAssembler {
  private words: TimedWord[] = [];
  private overlapWindow: number;
  private minOverlap: number;
  private matchRatio: number;

  constructor(opts: AssemblerOpts = {}) {
    this.overlapWindow = opts.overlapWindow ?? 16;
    this.minOverlap = opts.minOverlap ?? 2;
    this.matchRatio = opts.matchRatio ?? 0.6;
  }

  reset() {
    this.words = [];
  }

  // Feed one raw OCR observation captured at `time` seconds. Only the genuinely
  // new tail words are appended; the overlap with what we already have is matched
  // fuzzily so OCR jitter (a flickering last word) doesn't duplicate content.
  add(text: string, time: number) {
    const toks: TimedWord[] = text
      .split(/\s+/)
      .map((raw) => ({ raw, norm: normalize(raw), time }))
      .filter((t) => t.norm.length > 0);
    if (!toks.length) return;

    const L = this.words.length;
    if (L === 0) {
      this.words.push(...toks);
      return;
    }

    // Try aligning `toks` against the tail of the committed transcript: find the
    // start position `p` whose overlapping region matches best.
    const from = Math.max(0, L - this.overlapWindow);
    let bestP = L; // default: no overlap found → treat everything as new
    let bestScore = 0;
    for (let p = from; p < L; p++) {
      const overlapLen = Math.min(toks.length, L - p);
      if (overlapLen < this.minOverlap) continue;
      let matches = 0;
      for (let i = 0; i < overlapLen; i++) {
        if (this.words[p + i].norm === toks[i].norm) matches++;
      }
      const score = matches / overlapLen;
      // Prefer the highest score; on ties prefer the longer overlap (smaller p).
      if (score > bestScore) {
        bestScore = score;
        bestP = p;
      }
    }

    // Accept the alignment only if confident; otherwise the line is fresh content.
    const startP = bestScore >= this.matchRatio ? bestP : L;
    const overlapLen = Math.min(toks.length, L - startP);
    const tail = toks.slice(overlapLen);

    // Repetition guard: don't append a tail that just repeats the words already
    // sitting at the end (e.g. a recurring watermark caption re-read).
    if (tail.length && !this.endsWith(tail)) {
      this.words.push(...tail);
    }
  }

  // True if the last `tail.length` committed words equal `tail` (by norm).
  private endsWith(tail: TimedWord[]): boolean {
    const L = this.words.length;
    if (tail.length > L) return false;
    for (let i = 0; i < tail.length; i++) {
      if (this.words[L - tail.length + i].norm !== tail[i].norm) return false;
    }
    return true;
  }

  // The full reconstructed transcript so far.
  transcript(): string {
    return this.words.map((w) => w.raw).join(" ");
  }

  // Chunk the committed words into segments. A segment ends on sentence-ending
  // punctuation, a long pause between words, or a max word count — whichever
  // comes first. Each duration runs up to the next segment's start so playback
  // timing stays contiguous.
  segments(opts: { maxWords?: number; gapSec?: number } = {}): Segment[] {
    const maxWords = opts.maxWords ?? 10;
    const gapSec = opts.gapSec ?? 1.2;
    const out: Segment[] = [];
    let cur: TimedWord[] = [];

    const flush = (nextStart?: number) => {
      if (!cur.length) return;
      const start = cur[0].time;
      const lastT = cur[cur.length - 1].time;
      const end = nextStart ?? lastT + 0.5; // trailing segment gets a small tail
      const duration = Math.max(0.4, Number((end - start).toFixed(2)));
      out.push({
        start: Number(start.toFixed(2)),
        duration,
        text: cur.map((w) => w.raw).join(" "),
      });
      cur = [];
    };

    for (let i = 0; i < this.words.length; i++) {
      const w = this.words[i];
      const prev = cur[cur.length - 1];
      // A big pause means a new caption — close the current segment first.
      if (prev && w.time - prev.time > gapSec) flush(w.time);
      cur.push(w);
      if (cur.length >= maxWords || /[.!?]$/.test(w.raw)) {
        flush(this.words[i + 1]?.time);
      }
    }
    flush();
    return out;
  }
}

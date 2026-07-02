// F5 dub via the backend async /jobs API (POST + poll).
//
// Replaces the old Azure SSE /process flow: we create a job, then poll until the
// GPU (Modal F5) finishes and each segment has a public R2 audio_url to play.

import { firebaseAuth } from "@/lib/firebase";

export type TranscriptSegment = { start: number; duration: number; text: string };

export type DubJobSegment = {
  index: number;
  start: number;
  duration: number;
  text: string;
  translated_text: string | null;
  audio_url: string | null;
  audio_ms: number | null;
};

export type DubJob = {
  id: string;
  status: "queued" | "processing" | "done" | "failed";
  progress: number;
  segments: DubJobSegment[];
  error: string | null;
};

function backendUrl(path: string): string {
  let base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
  if (base && !/^https?:\/\//.test(base)) base = `http://${base}`;
  return `${base}${path}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = firebaseAuth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

// Create (or reuse, via backend cache/dedup) a dub job. Returns immediately with
// the job — translation is already filled in; audio_url arrives once status=done.
export async function createDubJob(
  payload: {
    video_id: string;
    source_lang: string;
    segments: TranscriptSegment[];
    voice_ref?: string; // preset voice ("male"/"female")
  },
  signal?: AbortSignal,
): Promise<DubJob> {
  const res = await fetch(backendUrl("/jobs"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    credentials: "include",
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Dub job failed (${res.status}).`);
  }
  return (await res.json()) as DubJob;
}

export async function getDubJob(id: string, signal?: AbortSignal): Promise<DubJob> {
  const res = await fetch(backendUrl(`/jobs/${id}`), {
    headers: await authHeaders(),
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `Job poll failed (${res.status}).`);
  }
  return (await res.json()) as DubJob;
}

// Poll until the job is done/failed. onUpdate fires on every poll so the UI can
// show progress. Resolves with the terminal job.
export async function pollDubJob(
  id: string,
  opts: { onUpdate?: (job: DubJob) => void; signal?: AbortSignal; intervalMs?: number } = {},
): Promise<DubJob> {
  const { onUpdate, signal, intervalMs = 2500 } = opts;
  while (true) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const job = await getDubJob(id, signal);
    onUpdate?.(job);
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

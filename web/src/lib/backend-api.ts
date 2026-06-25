const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export type Segment = {
  start: number;
  duration: number;
  text: string;
  source: "youtube_captions" | "whisper";
  translated_text: string | null;
  audio_path: string | null;
  audio_ms: number | null;
};

export type ProcessResult = {
  video_id: string;
  segments: Segment[];
};

export async function syncFirebaseUser(idToken: string) {
  const response = await fetch(`${API_BASE_URL}/auth/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Backend auth sync failed: ${detail}`);
  }

  return response.json();
}

export async function processVideo(videoId: string): Promise<ProcessResult> {
  const response = await fetch(`${API_BASE_URL}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: videoId }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Video processing failed: ${detail}`);
  }

  return response.json();
}

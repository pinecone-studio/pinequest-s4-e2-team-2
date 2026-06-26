import { firebaseAuth } from "@/lib/firebase";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL!
).replace(/\/+$/, "");

// Нэвтэрсэн хэрэглэгчийн Firebase ID token-ийг бүх backend хүсэлтэд автоматаар хавсаргадаг
// төв fetch wrapper. Энэ нь frontend талын auth "middleware"-ийн үүргийг гүйцэтгэнэ.
export async function authFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const user = firebaseAuth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    headers.set("Authorization", `Bearer ${token}`);
  }
  // Always send the guest-session cookie too, so requests still authenticate
  // when there's no signed-in Firebase user (see createGuestSession below).
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: init.credentials ?? "include",
  });
}

export type UserProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string;
};

export type RegisterResponse = {
  user: UserProfile;
  custom_token: string;
};

export type VideoHistoryPayload = {
  video_id: string;
  last_position_ms?: number;
  watched_seconds?: number;
  completed?: boolean;
  youtube_url?: string;
  title?: string;
  channel_name?: string;
  thumbnail_url?: string;
  duration_seconds?: number;
};

export type VideoHistoryRecord = Required<
  Pick<VideoHistoryPayload, "video_id" | "last_position_ms" | "watched_seconds" | "completed">
> &
  Omit<VideoHistoryPayload, "video_id" | "last_position_ms" | "watched_seconds" | "completed"> & {
    id: string;
    user_id: string;
    notes_count: number;
    last_watched_at: string;
    created_at: string;
    updated_at: string;
  };

export type NoteRecord = {
  id: string;
  video_id: string;
  user_id: string;
  timestamp_ms: number;
  content: string;
  created_at: string;
  updated_at: string;
};

async function readErrorDetail(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    if (payload && typeof payload.detail === "string") {
      return payload.detail;
    }
  }
  return response.text();
}

export async function registerBackendUser(payload: {
  email: string;
  password: string;
  name?: string;
}): Promise<RegisterResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || "Registration failed");
  }

  return response.json();
}

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

export type CaptionsResult = {
  video_id: string;
  source_lang: string;
  segments: Segment[];
};

// Lightweight captions-only fetch (no translation/TTS) — fast enough for the
// free-tier backend. Backed by POST /captions (youtube_transcript_api).
export async function fetchCaptions(videoId: string): Promise<CaptionsResult> {
  const response = await authFetch(`/captions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: videoId }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || "Captions failed to load");
  }

  return response.json();
}

export async function syncFirebaseUser(idToken: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/auth/sync`, {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`Backend auth sync failed: ${detail}`);
  }

  return response.json();
}

// Creates a guest/tester session: backend issues an httponly session cookie
// and we get back a guest UserProfile. Used whenever Firebase auth isn't
// available or fails, so the app stays usable without signing in.
export async function createGuestSession(): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/auth/guest`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`Guest session creation failed: ${detail}`);
  }

  return response.json();
}

export async function fetchWatchHistory(limit = 30): Promise<VideoHistoryRecord[]> {
  const response = await authFetch(`/videos/history?limit=${limit}`);

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || "Watch history failed");
  }

  return response.json();
}

export async function recordWatchHistory(
  payload: VideoHistoryPayload,
): Promise<VideoHistoryRecord> {
  const response = await authFetch("/videos/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || "Watch history update failed");
  }

  return response.json();
}

// Restores whichever session is active: a Firebase ID token (pass it in
// when a Firebase user is signed in client-side) or the session_id cookie
// set by createGuestSession. Throws (401) if neither is present/valid.
export async function getCurrentUser(idToken?: string): Promise<UserProfile> {
  const headers: HeadersInit = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`Fetching current user failed: ${detail}`);
  }

  return response.json();
}

export async function fetchVideoNotes(videoId: string): Promise<NoteRecord[]> {
  const response = await authFetch(`/videos/${videoId}/notes`);

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || "Notes fetch failed");
  }

  return response.json();
}

export async function createVideoNote(
  videoId: string,
  timestampMs: number,
  content: string,
): Promise<NoteRecord> {
  const response = await authFetch(`/videos/${videoId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_id: videoId,
      timestamp_ms: timestampMs,
      content,
    }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || "Note save failed");
  }

  return response.json();
}

export async function processVideo(videoId: string): Promise<ProcessResult> {
  const response = await authFetch(`/process`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_id: videoId }),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`Video processing failed: ${detail}`);
  }

  return response.json();
}

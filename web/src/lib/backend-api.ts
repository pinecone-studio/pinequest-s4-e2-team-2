import { apifetch } from "./axios";

// All backend calls go through `apifetch` (see lib/axios.ts): it attaches the
// Firebase token, sends the guest-session cookie (withCredentials), returns the
// parsed body directly, and throws with the backend's `detail` on error.

export const TRANSLATION_CACHE_VERSION =
  process.env.NEXT_PUBLIC_TRANSLATION_CACHE_VERSION ?? "sentence-v2";

// ===== Types =====

export type UserProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  plan: "free" | "pro";
  subscription_status: "none" | "active" | "past_due" | "canceled";
  subscription_provider: string | null;
  subscription_current_period_end: string | null;
  is_pro: boolean;
  free_video_limit: number;
  free_videos_used: number;
  free_videos_remaining: number;
  created_at: string;
  updated_at: string;
  last_login_at: string;
};

export type UserEntitlements = {
  user_id: string;
  plan: "free" | "pro";
  subscription_status: "none" | "active" | "past_due" | "canceled";
  is_pro: boolean;
  free_video_limit: number;
  free_videos_used: number;
  free_videos_remaining: number;
  can_watch_video: boolean;
  can_use_notes: boolean;
  can_use_ai: boolean;
};

export type PaymentStatus = "pending" | "paid" | "failed" | "canceled" | "expired";

export type QPayBankUrl = {
  name: string | null;
  description: string | null;
  link: string | null;
  logo: string | null;
};

export type PaymentOrderRecord = {
  id: string;
  user_id: string;
  provider: "quickpay";
  status: PaymentStatus;
  plan_id: string | null;
  subscription_days: number | null;
  amount: number;
  currency: string;
  description: string;
  callback_url: string | null;
  qpay_sender_invoice_no: string;
  qpay_invoice_id: string | null;
  qpay_payment_id: string | null;
  qpay_payment_status: string | null;
  qpay_paid_amount: number | null;
  qr_text: string | null;
  qr_image: string | null;
  urls: QPayBankUrl[];
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
};

export type QPayCreatePaymentResponse = {
  order: PaymentOrderRecord;
  invoice_id: string | null;
  qr_text: string | null;
  qr_image: string | null;
  urls: QPayBankUrl[];
};

export type QPayPaymentStatusResponse = {
  order: PaymentOrderRecord;
  paid: boolean;
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

export type Segment = {
  start: number;
  duration: number;
  text: string;
  source: "youtube_captions" | "whisper";
  translated_text: string | null;
  audio_path: string | null;
  audio_ms: number | null;
  audio_b64?: string | null;
};

export type ProcessResult = {
  video_id: string;
  segments: Segment[];
};

export type CachedTranscriptSegment = {
  start: number;
  duration: number;
  text: string;
  translated_text?: string | null;
};

export type CachedVideoTranscript = {
  video_id: string;
  source_lang: string;
  translation_version?: string | null;
  translation_mode?: "subtitle" | "dub" | null;
  segments: CachedTranscriptSegment[];
};

export type AssistantMode = "help" | "current_segment" | "summary" | "question";

export type AssistantSegmentPayload = {
  start: number;
  duration: number;
  text: string;
  translated_text?: string | null;
};

export type AssistantChatPayload = {
  mode: AssistantMode;
  question?: string;
  video_id?: string;
  current_time?: number;
  segments?: AssistantSegmentPayload[];
};

export type AssistantChatResponse = {
  mode: AssistantMode;
  answer: string;
};

// ===== Auth =====

export function registerBackendUser(payload: {
  email: string;
  password: string;
  name?: string;
}): Promise<RegisterResponse> {
  return apifetch<RegisterResponse>("/auth/register", { method: "POST", data: payload });
}

// Demo login: backend creates/returns a shared demo account (RegisterResponse).
export function createDemoBackendSession(): Promise<RegisterResponse> {
  return apifetch<RegisterResponse>("/auth/demo", { method: "POST" });
}

export function syncFirebaseUser(idToken: string): Promise<UserProfile> {
  // Pass the token explicitly: right after sign-in firebaseAuth.currentUser may
  // not be populated yet, so don't rely on the interceptor here.
  return apifetch<UserProfile>("/auth/sync", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
  });
}

// Creates a guest/tester session WITHOUT registration: the backend issues an
// httponly session cookie and returns a guest UserProfile. This is how the app
// stays usable without signing up — call it on landing / "Continue as guest".
export function createGuestSession(): Promise<UserProfile> {
  return apifetch<UserProfile>("/auth/guest", { method: "POST" });
}

// Restores whichever session is active: a Firebase ID token (passed in) or the
// session_id cookie set by createGuestSession. Throws (401) if neither is valid.
export function getCurrentUser(idToken?: string): Promise<UserProfile> {
  return apifetch<UserProfile>(
    "/auth/me",
    idToken ? { headers: { Authorization: `Bearer ${idToken}` } } : {},
  );
}

export function getEntitlements(): Promise<UserEntitlements> {
  return apifetch<UserEntitlements>("/auth/entitlements");
}

// ===== Payments =====

export function createQPayPayment(): Promise<QPayCreatePaymentResponse> {
  return apifetch<QPayCreatePaymentResponse>("/payments/quickpay/create", {
    method: "POST",
    data: { plan_id: "pro_monthly" },
  });
}

export function getQPayPaymentStatus(orderId: string): Promise<QPayPaymentStatusResponse> {
  return apifetch<QPayPaymentStatusResponse>(`/payments/quickpay/status/${orderId}`);
}

// ===== Watch history =====

export function fetchWatchHistory(limit = 30): Promise<VideoHistoryRecord[]> {
  return apifetch<VideoHistoryRecord[]>("/videos/history", { params: { limit } });
}

export function recordWatchHistory(
  payload: VideoHistoryPayload,
): Promise<VideoHistoryRecord> {
  return apifetch<VideoHistoryRecord>("/videos/history", { method: "POST", data: payload });
}

export function fetchCachedVideoTranscript(
  videoId: string,
  signal?: AbortSignal,
): Promise<CachedVideoTranscript> {
  return apifetch<CachedVideoTranscript>(`/videos/${videoId}/transcript`, {
    signal,
  });
}

export function saveCachedVideoTranscript(
  payload: CachedVideoTranscript,
  signal?: AbortSignal,
): Promise<CachedVideoTranscript> {
  return apifetch<CachedVideoTranscript>(`/videos/${payload.video_id}/transcript`, {
    method: "PUT",
    data: payload,
    signal,
  });
}

// ===== Notes =====

export function fetchVideoNotes(videoId: string): Promise<NoteRecord[]> {
  return apifetch<NoteRecord[]>(`/videos/${videoId}/notes`);
}

export function createVideoNote(
  videoId: string,
  timestampMs: number,
  content: string,
): Promise<NoteRecord> {
  return apifetch<NoteRecord>(`/videos/${videoId}/notes`, {
    method: "POST",
    data: { video_id: videoId, timestamp_ms: timestampMs, content },
  });
}

// ===== Assistant chatbot =====

export function chatWithAssistant(
  payload: AssistantChatPayload,
): Promise<AssistantChatResponse> {
  return apifetch<AssistantChatResponse>("/assistant/chat", {
    method: "POST",
    data: payload,
  });
}

// ===== Dub pipeline =====

export function processVideo(videoId: string): Promise<ProcessResult> {
  // Backend expects ProcessRequest{ video_id } — snake_case.
  return apifetch<ProcessResult>("/process", { method: "POST", data: { video_id: videoId } });
}

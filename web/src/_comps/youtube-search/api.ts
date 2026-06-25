import type { YouTubeSearchResponse, YouTubeSearchResult } from "@/lib/youtube-search";

type FetchYouTubeResultsOptions = {
  signal?: AbortSignal;
  type?: "video" | "channel" | "playlist";
  pages?: number;
};

export async function fetchYouTubeResults(
  query: string,
  options: FetchYouTubeResultsOptions = {},
): Promise<YouTubeSearchResult[]> {
  const params = new URLSearchParams({ q: query });

  if (options.type) params.set("type", options.type);
  if (options.pages) params.set("pages", String(options.pages));

  const response = await fetch(`/api/youtube/search?${params.toString()}`, {
    signal: options.signal,
  });
  const data = (await response.json().catch(() => ({}))) as
    | YouTubeSearchResponse
    | { error?: string };

  if (!response.ok) {
    throw new Error("error" in data ? data.error : "YouTube хайлт амжилтгүй боллоо.");
  }

  return "results" in data ? data.results : [];
}

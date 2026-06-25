import {
  YoutubeTranscriptNotAvailableLanguageError,
  fetchTranscript,
  type TranscriptResponse,
} from "youtube-transcript";

export type TranscriptSegment = {
  start: number;
  duration: number;
  end: number;
  text: string;
  language: string;
  source: "youtube-caption" | "youtube-auto-caption";
};

export type YouTubeTranscript = {
  videoId: string;
  language: string;
  source: TranscriptSegment["source"];
  segments: TranscriptSegment[];
};

async function fetchTranscriptItems(videoId: string, preferredLanguage: string) {
  try {
    return await fetchTranscript(videoId, { lang: preferredLanguage });
  } catch (error) {
    if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
      return fetchTranscript(videoId);
    }

    throw error;
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function itemUsesMilliseconds(item: TranscriptResponse) {
  return item.duration > 100 || item.offset > 60_000;
}

function normalizeTime(value: number, usesMilliseconds: boolean) {
  return usesMilliseconds ? value / 1000 : value;
}

function toTranscriptSegments(items: TranscriptResponse[], fallbackLanguage: string) {
  return items
    .map((item) => {
      const usesMilliseconds = itemUsesMilliseconds(item);
      const start = normalizeTime(item.offset, usesMilliseconds);
      const duration = normalizeTime(item.duration, usesMilliseconds);
      const text = normalizeWhitespace(item.text);

      return {
        start,
        duration,
        end: start + duration,
        text,
        language: item.lang ?? fallbackLanguage,
        source: "youtube-caption" as const,
      };
    })
    .filter((segment) => segment.text.length > 0);
}

export async function getYouTubeTranscript(
  videoId: string,
  preferredLanguage = "en",
): Promise<YouTubeTranscript> {
  const items = await fetchTranscriptItems(videoId, preferredLanguage);
  const segments = toTranscriptSegments(items, preferredLanguage);

  return {
    videoId,
    language: segments[0]?.language ?? preferredLanguage,
    source: segments[0]?.source ?? "youtube-caption",
    segments,
  };
}

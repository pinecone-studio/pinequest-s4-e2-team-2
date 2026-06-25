import type {
  YouTubeChannelSearchResult,
  YouTubePlaylistSearchResult,
  YouTubeSearchResult,
  YouTubeVideoSearchResult,
} from "@/lib/youtube-search";
import { VIDEO_ID_RE, type ChannelTab } from "./constants";

export function getYouTubeVideoId(value: string) {
  const input = value.trim();

  if (VIDEO_ID_RE.test(input)) return input;

  try {
    const url = new URL(input.startsWith("http") ? input : `https://${input}`);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return VIDEO_ID_RE.test(id) ? id : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      const watchId = url.searchParams.get("v");
      if (watchId && VIDEO_ID_RE.test(watchId)) return watchId;

      const [, route, id] = url.pathname.split("/");
      if ((route === "shorts" || route === "embed") && VIDEO_ID_RE.test(id)) return id;
    }
  } catch {
    return null;
  }

  return null;
}

export function isVideoResult(item: YouTubeSearchResult): item is YouTubeVideoSearchResult {
  return item.kind === "video" || item.kind === "live";
}

export function isChannelResult(item: YouTubeSearchResult): item is YouTubeChannelSearchResult {
  return item.kind === "channel";
}

export function isPlaylistResult(item: YouTubeSearchResult): item is YouTubePlaylistSearchResult {
  return item.kind === "playlist";
}

export function channelMatchesItem(
  channel: YouTubeChannelSearchResult,
  item: YouTubeSearchResult,
) {
  if (!isVideoResult(item) && !isPlaylistResult(item)) return false;

  const normalizeText = (text: string) => text.trim().toLowerCase();
  const normalizeUrl = (url: string) => url.trim().replace(/\/$/, "").toLowerCase();

  if (channel.url && item.channelUrl && normalizeUrl(channel.url) === normalizeUrl(item.channelUrl)) {
    return true;
  }

  return normalizeText(channel.channelTitle) === normalizeText(item.channelTitle);
}

export function formatViews(value: number | null) {
  if (typeof value !== "number") return "";
  return `${new Intl.NumberFormat("mn-MN", { notation: "compact" }).format(value)} үзэлт`;
}

export function resultKey(item: YouTubeSearchResult) {
  return `${item.kind}-${item.id}`;
}

export function resultKindLabel(item: YouTubeSearchResult) {
  if (item.kind === "channel") return "Channel";
  if (item.kind === "playlist") return "Playlist";
  if (item.kind === "live") return "Live";
  return "Видео";
}

export function mergeSearchResults(...groups: YouTubeSearchResult[][]) {
  const merged = new Map<string, YouTubeSearchResult>();

  groups.flat().forEach((item) => {
    const key = resultKey(item);
    if (!merged.has(key)) merged.set(key, item);
  });

  return Array.from(merged.values());
}

function parseDurationSeconds(value: string) {
  const parts = value
    .split(":")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 0) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function isShortLikeVideo(item: YouTubeSearchResult): item is YouTubeVideoSearchResult {
  if (!isVideoResult(item) || item.kind === "live") return false;

  const seconds = parseDurationSeconds(item.durationLabel);
  const text = `${item.title} ${item.description} ${item.url}`.toLowerCase();

  return Boolean((seconds !== null && seconds <= 61) || text.match(/(^|\W)#?shorts?(\W|$)/));
}

export function isPodcastLikeItem(item: YouTubeSearchResult) {
  if (!isVideoResult(item) && !isPlaylistResult(item)) return false;

  const text = `${item.title} ${item.description} ${item.channelTitle}`.toLowerCase();
  return /podcasts?|episodes?|audio/.test(text);
}

export function getChannelTabQuery(channel: YouTubeChannelSearchResult, tab: ChannelTab) {
  const title = channel.channelTitle || channel.title;

  const queries: Record<ChannelTab, string> = {
    home: title,
    videos: `${title} videos`,
    shorts: `${title} shorts`,
    live: `${title} live`,
    podcasts: `${title} podcast`,
    playlists: title,
  };

  return queries[tab];
}

function getChannelScopedItems(channel: YouTubeChannelSearchResult, items: YouTubeSearchResult[]) {
  const contentItems = items.filter(
    (item): item is YouTubeVideoSearchResult | YouTubePlaylistSearchResult =>
      isVideoResult(item) || isPlaylistResult(item),
  );
  const channelMatches = contentItems.filter((item) => channelMatchesItem(channel, item));

  return channelMatches.length > 0 ? channelMatches : contentItems;
}

function filterItemsForChannelTab(tab: ChannelTab, items: YouTubeSearchResult[]) {
  if (tab === "home") return items.filter((item) => isVideoResult(item) || isPlaylistResult(item));
  if (tab === "videos") return items.filter((item) => item.kind === "video");
  if (tab === "playlists") return items.filter(isPlaylistResult);

  if (tab === "live") {
    const liveItems = items.filter((item) => item.kind === "live");
    return liveItems.length > 0
      ? liveItems
      : items.filter((item) => isVideoResult(item) && /live|stream|premiere/i.test(item.title));
  }

  if (tab === "shorts") {
    const shortItems = items.filter(isShortLikeVideo);
    return shortItems.length > 0 ? shortItems : items.filter(isVideoResult);
  }

  const podcastItems = items.filter(isPodcastLikeItem);
  return podcastItems.length > 0
    ? podcastItems
    : items.filter((item) => isVideoResult(item) || isPlaylistResult(item));
}

export function getChannelTabItems(
  channel: YouTubeChannelSearchResult,
  tab: ChannelTab,
  items: YouTubeSearchResult[],
) {
  return filterItemsForChannelTab(tab, getChannelScopedItems(channel, items));
}

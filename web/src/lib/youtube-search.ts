export type YouTubeSearchKind = "video" | "live" | "channel" | "playlist";

export type YouTubeSearchBaseResult = {
  kind: YouTubeSearchKind;
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  url: string;
};

export type YouTubeVideoSearchResult = YouTubeSearchBaseResult & {
  kind: "video" | "live";
  videoId: string;
  channelId: string;
  channelTitle: string;
  channelUrl: string;
  publishedAt: string;
  durationLabel: string;
  ago: string;
  views: number | null;
};

export type YouTubeChannelSearchResult = YouTubeSearchBaseResult & {
  kind: "channel";
  channelId: string;
  channelTitle: string;
  about: string;
  subscriberCountLabel: string;
  videoCountLabel: string;
  verified: boolean;
};

export type YouTubePlaylistSearchResult = YouTubeSearchBaseResult & {
  kind: "playlist";
  playlistId: string;
  channelTitle: string;
  channelUrl: string;
  videoCount: number | null;
};

export type YouTubeSearchResult =
  | YouTubeVideoSearchResult
  | YouTubeChannelSearchResult
  | YouTubePlaylistSearchResult;

export type YouTubeSearchResponse = {
  results: YouTubeSearchResult[];
};

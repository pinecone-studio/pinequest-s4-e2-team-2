export type ChannelTab = "home" | "videos" | "shorts" | "live" | "podcasts" | "playlists";

export const CHANNEL_TABS: Array<{ id: ChannelTab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "videos", label: "Videos" },
  { id: "shorts", label: "Shorts" },
  { id: "live", label: "Live" },
  { id: "podcasts", label: "Podcasts" },
  { id: "playlists", label: "Playlists" },
];

export const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

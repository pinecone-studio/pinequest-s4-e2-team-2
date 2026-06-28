import type { NextRequest } from "next/server";
import type { YouTubeSearchResponse, YouTubeSearchResult } from "@/lib/youtube-search";
import type { SearchChannel, SearchItem, SearchPlaylist, SearchVideo } from "yt-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchResultType = "all" | "video" | "channel" | "playlist";
type YouTubeSearch = typeof import("yt-search").default;

const TYPE_FILTERS: Partial<Record<SearchResultType, string>> = {
  video: "EgIQAQ%3D%3D",
  channel: "EgIQAg%3D%3D",
  playlist: "EgIQAw%3D%3D",
};

async function getYouTubeSearch(): Promise<YouTubeSearch> {
  const ytSearchModule = await import("yt-search");
  return typeof ytSearchModule === "function" ? ytSearchModule : ytSearchModule.default!;
}

function getSearchType(value: string | null): SearchResultType {
  if (value === "video" || value === "channel" || value === "playlist") {
    return value;
  }

  return "all";
}

function getPages(value: string | null) {
  const pages = Number(value ?? "1");

  if (!Number.isFinite(pages)) {
    return 1;
  }

  return Math.min(Math.max(Math.floor(pages), 1), 4);
}

function getVideoId(video: SearchVideo) {
  if (video.videoId) {
    return video.videoId;
  }

  if (!video.url) {
    return null;
  }

  try {
    return new URL(video.url).searchParams.get("v");
  } catch {
    return null;
  }
}

function getPlaylistId(playlist: SearchPlaylist) {
  if (playlist.listId) {
    return playlist.listId;
  }

  if (!playlist.url) {
    return null;
  }

  try {
    return new URL(playlist.url).searchParams.get("list");
  } catch {
    return null;
  }
}

function getThumbnail(item: SearchChannel | SearchPlaylist | SearchVideo, fallbackId?: string) {
  return (
    item.thumbnail ??
    item.image ??
    (fallbackId ? `https://img.youtube.com/vi/${fallbackId}/mqdefault.jpg` : "")
  );
}

function getVideoThumbnail(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function toVideoResult(video: SearchVideo, kind: "video" | "live"): YouTubeSearchResult | null {
  const videoId = getVideoId(video);

  if (!videoId || !video.title) {
    return null;
  }

  return {
    kind,
    id: videoId,
    videoId,
    title: video.title,
    description: video.description ?? "",
    channelId: "",
    channelTitle: video.author?.name ?? "",
    channelUrl: video.author?.url ?? "",
    publishedAt: "",
    durationLabel: video.timestamp ?? "",
    ago: video.ago ?? "",
    views: typeof video.views === "number" ? video.views : null,
    thumbnailUrl: getVideoThumbnail(videoId),
    url: video.url ?? `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function toChannelResult(channel: SearchChannel): YouTubeSearchResult | null {
  const title = channel.title ?? channel.name;
  const channelId = channel.id ?? channel.url ?? title;

  if (!title || !channel.url || !channelId) {
    return null;
  }

  return {
    kind: "channel",
    id: channelId,
    channelId,
    title,
    channelTitle: title,
    description: channel.about ?? "",
    about: channel.about ?? "",
    subscriberCountLabel: channel.subCountLabel ?? "",
    videoCountLabel: channel.videoCountLabel ?? "",
    verified: Boolean(channel.verified),
    thumbnailUrl: getThumbnail(channel),
    url: channel.url,
  };
}

function toPlaylistResult(playlist: SearchPlaylist): YouTubeSearchResult | null {
  const playlistId = getPlaylistId(playlist);

  if (!playlistId || !playlist.title) {
    return null;
  }

  return {
    kind: "playlist",
    id: playlistId,
    playlistId,
    title: playlist.title,
    description: playlist.description ?? "",
    channelTitle: playlist.author?.name ?? "",
    channelUrl: playlist.author?.url ?? "",
    videoCount: typeof playlist.videoCount === "number" ? playlist.videoCount : null,
    thumbnailUrl: getThumbnail(playlist),
    url: playlist.url ?? `https://www.youtube.com/playlist?list=${playlistId}`,
  };
}

function toSearchResult(item: SearchItem): YouTubeSearchResult | null {
  if (item.type === "channel") {
    return toChannelResult(item);
  }

  if (item.type === "list") {
    return toPlaylistResult(item);
  }

  if (item.type === "live") {
    return toVideoResult(item, "live");
  }

  return toVideoResult(item as SearchVideo, "video");
}

function getTypedResults(
  data: Awaited<ReturnType<YouTubeSearch>>,
  type: SearchResultType,
) {
  if (type === "playlist") return data.playlists ?? [];
  if (type === "channel") return data.channels ?? [];
  if (type === "video") return data.videos ?? [];

  return [
    ...(data.all ?? []),
    ...(data.channels ?? []),
    ...(data.videos ?? []),
    ...(data.live ?? []),
    ...(data.playlists ?? []),
  ];
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  const type = getSearchType(request.nextUrl.searchParams.get("type"));
  const pages = getPages(request.nextUrl.searchParams.get("pages"));

  if (!query) {
    return Response.json({ error: "Search query is required." }, { status: 400 });
  }

  if (query.length > 120) {
    return Response.json({ error: "Search query is too long." }, { status: 400 });
  }

  try {
    const yts = await getYouTubeSearch();
    const data = await yts({
      query,
      pages,
      ...(TYPE_FILTERS[type] ? { sp: TYPE_FILTERS[type] } : {}),
    });
    const enrichedData =
      type === "all"
        ? await Promise.allSettled([
            yts({ query, pages: 1, sp: TYPE_FILTERS.channel }),
            yts({ query, pages: 1, sp: TYPE_FILTERS.playlist }),
          ])
        : [];

    const orderedResults = [
      ...getTypedResults(data, type),
      ...enrichedData.flatMap((result, index) => {
        if (result.status !== "fulfilled") return [];
        return getTypedResults(result.value, index === 0 ? "channel" : "playlist");
      }),
    ];
    const results = orderedResults
      .map(toSearchResult)
      .filter((item): item is YouTubeSearchResult => Boolean(item));
    const uniqueResults = Array.from(
      new Map(results.map((item) => [`${item.kind}-${item.id}`, item])).values(),
    );

    return Response.json(
      {
        results: uniqueResults,
      } satisfies YouTubeSearchResponse,
    );
  } catch (error) {
    console.log("YouTube search error:", error);
    const message = error instanceof Error ? error.message : "YouTube search failed.";

    return Response.json({ error: message }, { status: 502 });
  }
}

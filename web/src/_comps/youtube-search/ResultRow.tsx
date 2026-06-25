import Image from "next/image";
import { ArrowRight, ExternalLink } from "lucide-react";
import type { YouTubeSearchResult } from "@/lib/youtube-search";
import ResultIcon from "./ResultIcon";
import {
  formatViews,
  isChannelResult,
  isPlaylistResult,
  isVideoResult,
  resultKindLabel,
} from "./utils";

function ResultMeta({ item }: { item: YouTubeSearchResult }) {
  const views = isVideoResult(item) ? formatViews(item.views) : "";

  if (isChannelResult(item)) {
    return (
      <>
        {item.subscriberCountLabel && <span>{item.subscriberCountLabel} subscribers</span>}
        {item.verified && <span>Verified</span>}
      </>
    );
  }

  if (isPlaylistResult(item)) {
    return (
      <>
        {item.channelTitle && <span className="truncate">{item.channelTitle}</span>}
        {typeof item.videoCount === "number" && <span>{item.videoCount} videos</span>}
      </>
    );
  }

  return (
    <>
      {item.channelTitle && <span className="truncate">{item.channelTitle}</span>}
      {item.durationLabel && <span>{item.durationLabel}</span>}
      {views && <span>{views}</span>}
      {item.ago && <span>{item.ago}</span>}
    </>
  );
}

function ResultAction({ item }: { item: YouTubeSearchResult }) {
  if (item.kind === "channel") {
    return (
      <>
        Суваг руу
        <ArrowRight className="ml-1 w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
      </>
    );
  }

  if (item.kind === "playlist") {
    return (
      <>
        YouTube
        <ExternalLink className="ml-1 w-3.5 h-3.5" />
      </>
    );
  }

  return (
    <>
      Сонгох
      <ArrowRight className="ml-1 w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
    </>
  );
}

export default function ResultRow({
  item,
  onSelect,
}: {
  item: YouTubeSearchResult;
  onSelect: (item: YouTubeSearchResult) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group grid grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[140px_minmax(0,1fr)_auto] gap-3 rounded-xl border border-border bg-card p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        className={`relative aspect-video overflow-hidden bg-muted ${
          item.kind === "channel" ? "rounded-full w-20 h-20 aspect-square place-self-center" : "rounded-lg"
        }`}
      >
        {item.thumbnailUrl ? (
          <Image
            src={item.thumbnailUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 112px, 140px"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <ResultIcon item={item} />
          </div>
        )}
        {isVideoResult(item) && item.kind !== "live" && item.durationLabel && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/85 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white shadow-sm">
            {item.durationLabel}
          </span>
        )}
        {item.kind === "live" && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white shadow-sm">
            LIVE
          </span>
        )}
        {item.kind !== "channel" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 transition-opacity group-hover:opacity-100">
            <ResultIcon item={item} />
          </div>
        )}
      </div>

      <div className="min-w-0 py-0.5">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ResultIcon item={item} />
          <span>{resultKindLabel(item)}</span>
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {item.title}
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <ResultMeta item={item} />
        </div>
        {item.description && (
          <p className="mt-1 hidden sm:line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        )}
      </div>

      <div className="hidden sm:flex items-center pr-2 text-xs font-medium text-primary">
        <ResultAction item={item} />
      </div>
    </button>
  );
}

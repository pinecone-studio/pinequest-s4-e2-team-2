import Image from "next/image";
import { ChevronLeft, ExternalLink, Loader2, User } from "lucide-react";
import type { YouTubeChannelSearchResult, YouTubeSearchResult } from "@/lib/youtube-search";
import { CHANNEL_TABS, type ChannelTab } from "./constants";
import ResultRow from "./ResultRow";
import { getChannelTabItems, mergeSearchResults, resultKey } from "./utils";

export default function ChannelView({
  channel,
  results,
  tabResults,
  activeTab,
  isLoading,
  error,
  onTabChange,
  onBack,
  onSelect,
}: {
  channel: YouTubeChannelSearchResult;
  results: YouTubeSearchResult[];
  tabResults: Partial<Record<ChannelTab, YouTubeSearchResult[]>>;
  activeTab: ChannelTab;
  isLoading: boolean;
  error: string;
  onTabChange: (tab: ChannelTab) => void;
  onBack: () => void;
  onSelect: (item: YouTubeSearchResult) => void;
}) {
  const activeItems = mergeSearchResults(
    getChannelTabItems(channel, activeTab, results),
    tabResults[activeTab] ?? [],
  );

  return (
    <div className="mt-6 space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="w-4 h-4" />
        Хайлтын илэрц рүү буцах
      </button>

      <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
        <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-full bg-muted">
          {channel.thumbnailUrl ? (
            <Image src={channel.thumbnailUrl} alt="" fill sizes="80px" className="object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <User className="w-7 h-7" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-bold text-foreground">{channel.channelTitle}</h2>
            {channel.verified && (
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                Verified
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {channel.subscriberCountLabel && <span>{channel.subscriberCountLabel} subscribers</span>}
            {channel.videoCountLabel && channel.videoCountLabel !== "-1" && (
              <span>{channel.videoCountLabel} videos</span>
            )}
            <a
              href={channel.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              YouTube
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {channel.about && (
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {channel.about}
            </p>
          )}
        </div>
      </div>

      <div className="-mx-4 overflow-x-auto border-b border-border px-4">
        <div className="flex min-w-max gap-1">
          {CHANNEL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          YouTube-ээс энэ ангиллын илэрц татаж байна.
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {error}
        </div>
      )}

      {activeItems.length > 0 ? (
        <div className="grid gap-2">
          {activeItems.map((item) => (
            <ResultRow key={resultKey(item)} item={item} onSelect={onSelect} />
          ))}
        </div>
      ) : !isLoading ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Энэ хайлтын илэрц дотор энэ ангиллын item олдсонгүй.
        </div>
      ) : null}
    </div>
  );
}

import type { YouTubeSearchResult } from "@/lib/youtube-search";
import ResultRow from "./ResultRow";
import { resultKey } from "./utils";

type ResultCounts = {
  videos: number;
  shorts: number;
  live: number;
  podcasts: number;
  channels: number;
  playlists: number;
};

export default function SearchResults({
  query,
  results,
  counts,
  onSelect,
}: {
  query: string;
  results: YouTubeSearchResult[];
  counts: ResultCounts;
  onSelect: (item: YouTubeSearchResult) => void;
}) {
  if (results.length === 0) return null;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-foreground truncate">“{query}” хайлтын илэрц</p>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{counts.videos} videos</span>
          <span>{counts.shorts} shorts</span>
          <span>{counts.live} live</span>
          <span>{counts.podcasts} podcasts</span>
          <span>{counts.channels} channels</span>
          <span>{counts.playlists} playlists</span>
        </div>
      </div>

      <div className="grid gap-2">
        {results.map((item, index) => (
          <ResultRow key={`${resultKey(item)}-${index}`} item={item} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

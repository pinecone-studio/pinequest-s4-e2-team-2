import { List, PlayCircle, Radio, User } from "lucide-react";
import type { YouTubeSearchResult } from "@/lib/youtube-search";

export default function ResultIcon({ item }: { item: YouTubeSearchResult }) {
  if (item.kind === "channel") return <User className="w-4 h-4" />;
  if (item.kind === "playlist") return <List className="w-4 h-4" />;
  if (item.kind === "live") return <Radio className="w-4 h-4" />;
  return <PlayCircle className="w-4 h-4" />;
}

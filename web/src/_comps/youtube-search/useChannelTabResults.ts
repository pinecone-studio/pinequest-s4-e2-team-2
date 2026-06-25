import { useEffect, useState } from "react";
import type { YouTubeChannelSearchResult, YouTubeSearchResult } from "@/lib/youtube-search";
import { type ChannelTab } from "./constants";
import { fetchYouTubeResults } from "./api";
import { getChannelTabItems, getChannelTabQuery } from "./utils";

export function useChannelTabResults(
  selectedChannel: YouTubeChannelSearchResult | null,
  activeTab: ChannelTab,
) {
  const [tabResults, setTabResults] = useState<Partial<Record<ChannelTab, YouTubeSearchResult[]>>>(
    {},
  );
  const [loadingTab, setLoadingTab] = useState<ChannelTab | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedChannel || tabResults[activeTab]) return;

    const controller = new AbortController();
    const tab = activeTab;

    async function loadChannelTab() {
      if (!selectedChannel) return;

      setError("");
      setLoadingTab(tab);

      try {
        const results = await fetchYouTubeResults(getChannelTabQuery(selectedChannel, tab), {
          signal: controller.signal,
          ...(tab === "playlists" ? { type: "playlist" as const, pages: 4 } : {}),
        });
        const tabItems = getChannelTabItems(selectedChannel, tab, results);

        setTabResults((current) => ({
          ...current,
          [tab]: tabItems,
        }));
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;

        setTabResults((current) => ({
          ...current,
          [tab]: [],
        }));
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Энэ ангиллын илэрц татахад алдаа гарлаа.",
        );
      } finally {
        setLoadingTab((current) => (current === tab ? null : current));
      }
    }

    loadChannelTab();

    return () => {
      controller.abort();
    };
  }, [activeTab, selectedChannel, tabResults]);

  return {
    tabResults,
    loadingTab,
    error,
    clearError: () => setError(""),
    reset: () => {
      setTabResults({});
      setError("");
      setLoadingTab(null);
    },
  };
}

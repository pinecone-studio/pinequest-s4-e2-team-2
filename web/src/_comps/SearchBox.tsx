"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { YouTubeChannelSearchResult, YouTubeSearchResult } from "@/lib/youtube-search";
import ChannelView from "./youtube-search/ChannelView";
import SearchForm from "./youtube-search/SearchForm";
import SearchResults from "./youtube-search/SearchResults";
import { fetchYouTubeResults } from "./youtube-search/api";
import { type ChannelTab } from "./youtube-search/constants";
import { useChannelTabResults } from "./youtube-search/useChannelTabResults";
import {
  getYouTubeVideoId,
  isChannelResult,
  isPlaylistResult,
  isPodcastLikeItem,
  isShortLikeVideo,
} from "./youtube-search/utils";

export default function SearchBox({ onSubmit }: { onSubmit: (url: string) => void }) {
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<YouTubeChannelSearchResult | null>(null);
  const [activeChannelTab, setActiveChannelTab] = useState<ChannelTab>("home");
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");
  const channelTabs = useChannelTabResults(selectedChannel, activeChannelTab);
  const searchSurfaceOpen =
    isSearching || Boolean(error) || results.length > 0 || selectedChannel !== null;

  const resultCounts = useMemo(
    () => ({
      videos: results.filter((item) => item.kind === "video").length,
      live: results.filter((item) => item.kind === "live").length,
      channels: results.filter((item) => item.kind === "channel").length,
      playlists: results.filter((item) => item.kind === "playlist").length,
      shorts: results.filter(isShortLikeVideo).length,
      podcasts: results.filter(isPodcastLikeItem).length,
    }),
    [results],
  );

  const clearChannelState = () => {
    setSelectedChannel(null);
    channelTabs.reset();
  };

  const dismissSearchSurface = useCallback(() => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setIsSearching(false);
    setError("");
    setResults([]);
    setSearchedQuery("");
    setSelectedChannel(null);
  }, []);

  const handleResultSelect = (item: YouTubeSearchResult) => {
    if (isChannelResult(item)) {
      channelTabs.reset();
      setSelectedChannel(item);
      setActiveChannelTab("home");
      return;
    }

    if (isPlaylistResult(item)) {
      window.open(item.url, "_blank", "noopener,noreferrer");
      return;
    }

    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setError("");
    setResults([]);
    setSearchedQuery("");
    clearChannelState();
    onSubmit(item.url);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = query.trim();
    const directVideoId = getYouTubeVideoId(trimmed);

    if (!trimmed) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setIsSearching(false);
      setError("Хайх үгээ оруулна уу.");
      setResults([]);
      clearChannelState();
      return;
    }

    if (directVideoId) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setError("");
      setResults([]);
      setSearchedQuery("");
      clearChannelState();
      onSubmit(`https://www.youtube.com/watch?v=${directVideoId}`);
      return;
    }

    if (trimmed.length < 2) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setIsSearching(false);
      setError("Хайлт дор хаяж 2 тэмдэгт байна.");
      setResults([]);
      clearChannelState();
      return;
    }

    setError("");
    setIsSearching(true);
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      const nextResults = await fetchYouTubeResults(trimmed, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResults(nextResults);
      setSearchedQuery(trimmed);
      clearChannelState();

      if (nextResults.length === 0) {
        setError("Илэрц олдсонгүй. Өөр түлхүүр үгээр хайгаарай.");
      }
    } catch (searchError) {
      if (controller.signal.aborted) return;
      setResults([]);
      clearChannelState();
      setError(
        searchError instanceof Error ? searchError.message : "YouTube хайлт амжилтгүй боллоо.",
      );
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  };

  useEffect(() => {
    if (!searchSurfaceOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (searchBoxRef.current?.contains(event.target)) return;
      dismissSearchSurface();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dismissSearchSurface();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dismissSearchSurface, searchSurfaceOpen]);

  return (
    <div ref={searchBoxRef} className="w-full max-w-4xl mx-auto px-4">
      <div className="text-center mb-6 space-y-3">
        <p className="text-muted-foreground text-sm sm:text-base max-w-lg mx-auto">
          YouTube-ээс видео, channel, playlist хайж, монгол хувилбарт бэлтгэх бичлэгээ сонго.
        </p>
      </div>

      <SearchForm
        query={query}
        error={error}
        isSearching={isSearching}
        onQueryChange={(value) => {
          setQuery(value);
          if (error) setError("");
        }}
        onSubmit={handleSubmit}
      />

      {selectedChannel ? (
        <ChannelView
          channel={selectedChannel}
          results={results}
          tabResults={channelTabs.tabResults}
          activeTab={activeChannelTab}
          isLoading={channelTabs.loadingTab === activeChannelTab}
          error={channelTabs.error}
          onTabChange={(tab) => {
            channelTabs.clearError();
            setActiveChannelTab(tab);
          }}
          onBack={() => setSelectedChannel(null)}
          onSelect={handleResultSelect}
        />
      ) : (
        <SearchResults
          query={searchedQuery}
          results={results}
          counts={resultCounts}
          onSelect={handleResultSelect}
        />
      )}
    </div>
  );
}

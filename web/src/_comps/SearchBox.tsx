"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  YouTubeChannelSearchResult,
  YouTubeSearchResult,
} from "@/lib/youtube-search";
import ChannelView from "./youtube-search/ChannelView";
import SearchForm from "./youtube-search/SearchForm";
import SearchResults from "./youtube-search/SearchResults";
import { type ChannelTab } from "./youtube-search/constants";
import { useChannelTabResults } from "./youtube-search/useChannelTabResults";
import {
  getYouTubeVideoId,
  isChannelResult,
  isPlaylistResult,
  isPodcastLikeItem,
  isShortLikeVideo,
  isVideoResult,
} from "./youtube-search/utils";
import { useVideoProcess } from "./providers/VideoProcessProvider";
import { useAuth } from "./providers/AuthProvider";

type SearchBoxUI = "middle" | "top" | "header";
interface SearchBoxProps {
  onSubmit: (url: string) => void;
  // Controlled layout: when provided, pins the box to this position and DISABLES
  // the middle↔top slide animation. When omitted, the box animates itself based
  // on whether it's in use (uncontrolled).
  //   "middle"/"top" → fixed, full-width overlay box
  //   "header"       → compact, inline box that lives inside the Header bar
  UI?: SearchBoxUI;
}
export default function SearchBox({ onSubmit, UI }: SearchBoxProps) {
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [selectedChannel, setSelectedChannel] =
    useState<YouTubeChannelSearchResult | null>(null);
  const [activeChannelTab, setActiveChannelTab] = useState<ChannelTab>("home");
  // Client-side input validation (empty / too-short) — kept separate from the
  // provider's async search error so we can show localized messages.
  const [validationError, setValidationError] = useState("");

  // Search now lives in the shared VideoProcessProvider: this box drives the
  // `searchVideo` action and renders the provider's results/loading/error.
  const {
    searchVideo,
    selectVideo,
    videoId,
    searchResults,
    isSearching,
    searchError,
    clearSearch,
    setVideoAction,
  } = useVideoProcess();
  const channelTabs = useChannelTabResults(selectedChannel, activeChannelTab);
  const error = validationError || searchError;
  // Slide the box up under the header once a signed-in user starts typing OR has
  // a video selected (so it stays compact above the dashboard).
  const active = Boolean(user) && (query.trim().length > 0 || Boolean(videoId));
  // Controlled (UI prop set) → pinned position, animation OFF. Uncontrolled →
  // follow `active` and animate the middle↔top slide.
  const controlled = UI !== undefined;
  const isHeader = UI === "header";
  const atTop = controlled ? UI !== "middle" : active;
  const animate = !controlled;
  const searchSurfaceOpen =
    isSearching ||
    Boolean(error) ||
    searchResults.length > 0 ||
    selectedChannel !== null;

  // While the search box is in use (typing or a results surface is open), flip
  // the shared state to "searching" so subscribers — e.g. AnimatedBackground —
  // can change the UI. Reset it when the box goes idle / on unmount.
  const inUse = active || searchSurfaceOpen;
  useEffect(() => {
    setVideoAction(inUse ? "searching" : null);
    return () => setVideoAction(null);
  }, [inUse, setVideoAction]);

  const resultCounts = useMemo(
    () => ({
      videos: searchResults.filter((item) => item.kind === "video").length,
      live: searchResults.filter((item) => item.kind === "live").length,
      channels: searchResults.filter((item) => item.kind === "channel").length,
      playlists: searchResults.filter((item) => item.kind === "playlist")
        .length,
      shorts: searchResults.filter(isShortLikeVideo).length,
      podcasts: searchResults.filter(isPodcastLikeItem).length,
    }),
    [searchResults],
  );

  const clearChannelState = useCallback(() => {
    setSelectedChannel(null);
    channelTabs.reset();
  }, [channelTabs]);

  const dismissSearchSurface = useCallback(() => {
    clearSearch();
    setValidationError("");
    setSearchedQuery("");
    clearChannelState();
  }, [clearSearch, clearChannelState]);

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

    clearSearch();
    setValidationError("");
    setSearchedQuery("");
    clearChannelState();
    // Signed-in: select the video through the provider (starts the pipeline,
    // sets videoAction). Logged-out: hand off to the page, which shows sign-in.
    if (user) {
      const meta = isVideoResult(item)
        ? {
            title: item.title,
            channelTitle: item.channelTitle,
            thumbnailUrl: item.thumbnailUrl,
          }
        : undefined;
      selectVideo(item.url, meta);
    } else {
      onSubmit(item.url);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = query.trim();
    const directVideoId = getYouTubeVideoId(trimmed);

    if (!trimmed) {
      clearSearch();
      clearChannelState();
      setValidationError("Хайх үгээ оруулна уу.");
      return;
    }

    if (directVideoId) {
      clearSearch();
      setValidationError("");
      setSearchedQuery("");
      clearChannelState();
      const url = `https://www.youtube.com/watch?v=${directVideoId}`;
      if (user) selectVideo(url);
      else onSubmit(url);
      return;
    }

    if (trimmed.length < 2) {
      clearSearch();
      clearChannelState();
      setValidationError("Хайлт дор хаяж 2 тэмдэгт байна.");
      return;
    }

    // Delegate the actual search to the provider; it owns results/loading/error.
    setValidationError("");
    setSearchedQuery(trimmed);
    clearChannelState();
    await searchVideo(trimmed);
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
    <div
      ref={searchBoxRef}
      className={
        isHeader
          ? "relative w-full max-w-md"
          : `fixed left-1/2 -translate-x-1/2 z-40 w-full max-w-4xl px-4 ${
              animate ? "transition-all duration-500 ease-out" : ""
            } ${atTop ? "top-20 translate-y-0" : "top-1/2 -translate-y-1/2"}`
      }
    >
      {!isHeader && (
        <div
          className={`text-center space-y-3 overflow-hidden ${
            animate ? "transition-all duration-300" : ""
          } ${atTop ? "max-h-0 opacity-0 mb-0" : "max-h-40 opacity-100 mb-6"}`}
        >
          <p className="text-muted-foreground text-sm sm:text-base max-w-lg mx-auto">
            YouTube-ээс видео, channel, playlist хайж, монгол хувилбарт бэлтгэх
            бичлэгээ сонго.
          </p>
        </div>
      )}

      <SearchForm
        query={query}
        error={error}
        isSearching={isSearching}
        onQueryChange={(value) => {
          setQuery(value);
          if (validationError) setValidationError("");
        }}
        onSubmit={handleSubmit}
      />

      {searchSurfaceOpen && (
        <div
          className={`overflow-y-auto rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-lg ${
            isHeader
              ? "absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh]"
              : "mt-3 max-h-[70vh]"
          }`}
        >
          {selectedChannel ? (
            <ChannelView
              channel={selectedChannel}
              results={searchResults}
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
              results={searchResults}
              counts={resultCounts}
              onSelect={handleResultSelect}
            />
          )}
        </div>
      )}
    </div>
  );
}

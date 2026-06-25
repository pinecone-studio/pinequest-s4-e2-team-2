"use client";

import { useState } from "react";
import { ThemeProvider } from "@/_comps/providers/ThemeProvider";
import Header from "@/_comps/Header";
import SearchBox from "@/_comps/SearchBox";
import PlayerView from "@/_comps/PlayerView";
import SignInModal from "@/_comps/SignInModal";
import AnimatedBackground from "@/_comps/AnimatedBackground";

type AppState = "search" | "player";

export default function Home() {
  const [appState, setAppState] = useState<AppState>("search");
  const [videoUrl, setVideoUrl] = useState("");
  const [showSignIn, setShowSignIn] = useState(false);

  const handleSearch = (url: string) => {
    setVideoUrl(url);
    setAppState("player");
  };

  const handleBack = () => {
    setAppState("search");
    setVideoUrl("");
  };

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
        <Header onSignIn={() => setShowSignIn(true)} />

        <main className="min-h-screen flex flex-col items-center justify-center pt-20 pb-12 px-4">
          {appState === "search" && (
            <div className="w-full flex flex-col items-center justify-center">
              <AnimatedBackground />
              <div className="relative w-full flex flex-col items-center">
                <SearchBox onSubmit={handleSearch} />
              </div>
            </div>
          )}

          {appState === "player" && (
            <div className="w-full flex flex-col items-center">
              <PlayerView videoUrl={videoUrl} onBack={handleBack} />
            </div>
          )}
        </main>

        {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}
      </div>
    </ThemeProvider>
  );
}

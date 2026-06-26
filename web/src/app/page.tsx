"use client";

import { useCallback, useState } from "react";
import { ThemeProvider } from "@/_comps/providers/ThemeProvider";
import { useAuth } from "@/_comps/providers/AuthProvider";
import Header from "@/_comps/Header";
import SearchBox from "@/_comps/SearchBox";
import DashboardView, { type DashboardVideoSelection } from "@/_comps/dashboard/DashboardView";
import SignInModal from "@/_comps/SignInModal";
import AnimatedBackground from "@/_comps/AnimatedBackground";

export default function Home() {
  const { user, loading, logout } = useAuth();
  const [selectedVideo, setSelectedVideo] = useState<DashboardVideoSelection | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);

  const handleSearch = useCallback((url: string, video?: DashboardVideoSelection) => {
    setSelectedVideo({ url, ...video });
  }, []);

  const handleUnauthenticatedVideoSelect = useCallback((url: string) => {
    setSelectedVideo({ url });
    setShowSignIn(true);
  }, []);

  if (loading) {
    return null;
  }

  if (user) {
    return (
      <ThemeProvider>
        <DashboardView
          videoUrl={selectedVideo?.url ?? ""}
          selectedVideo={selectedVideo}
          onBack={() => setSelectedVideo(null)}
          onSearch={handleSearch}
          onLogout={() => logout()}
        />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
        <Header onSignIn={() => setShowSignIn(true)} />

        <main className="min-h-screen flex flex-col items-center justify-center pt-20 pb-12 px-4">
          <div className="w-full flex flex-col items-center justify-center">
            <AnimatedBackground />
            <div className="relative w-full flex flex-col items-center">
              <SearchBox onSubmit={handleUnauthenticatedVideoSelect} />
            </div>
          </div>
        </main>

        {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}
      </div>
    </ThemeProvider>
  );
}

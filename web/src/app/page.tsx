"use client";

import { useCallback, useState } from "react";
import { ThemeProvider } from "@/_comps/providers/ThemeProvider";
import { useVideoProcess } from "@/_comps/providers/VideoProcessProvider";
import { useAuth } from "@/_comps/providers/AuthProvider";
import Header from "@/_comps/Header";
import SearchBox from "@/_comps/SearchBox";
import UserDashboard from "@/_comps/dashboard/UserDashboard";
import SignInModal from "@/_comps/SignInModal";
import AnimatedBackground from "@/_comps/AnimatedBackground";

export default function Home() {
  const { user, loading } = useAuth();
  // Single shared provider (mounted in the root layout) owns selection + pipeline.
  const { videoId } = useVideoProcess();
  const [showSignIn, setShowSignIn] = useState(false);

  // Only reached for LOGGED-OUT users clicking a result → prompt sign-in.
  // Signed-in selection is handled inside SearchBox via the provider.
  const handleUnauthenticatedVideoSelect = useCallback(() => {
    setShowSignIn(true);
  }, []);

  if (loading) {
    return null;
  }

  const showDashboard = Boolean(user && videoId);

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
        <Header onSignIn={() => setShowSignIn(true)} />
        <SearchBox onSubmit={handleUnauthenticatedVideoSelect} />
        {showDashboard ? (
          <UserDashboard />
        ) : (
          <main className="min-h-screen flex flex-col items-center justify-center pt-20 pb-12 px-4">
            <div className="w-full flex flex-col items-center justify-center">
              <AnimatedBackground />
            </div>
          </main>
        )}
        {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}
      </div>
    </ThemeProvider>
  );
}

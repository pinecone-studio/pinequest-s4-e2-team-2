"use client";

// Dashboard = just the video workspace: the VideoPane (player + subtitles + dub)
// and ONE collapsible sidebar (YTsidebar) with all five tabs. Everything else —
// selection, the processing pipeline and user data — is owned by the providers
// mounted in the root layout, so this page stays thin.

import Header from "@/_comps/Header";
import UserDashboard from "@/_comps/dashboard/UserDashboard";

export default function Page() {
  return (
    <>
      {/* Search lives in the header here (searchbar) — not on the dashboard body. */}
      <Header onSignIn={() => {}} searchbar />
      <UserDashboard />
    </>
  );
}

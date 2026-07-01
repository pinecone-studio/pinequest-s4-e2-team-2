"use client";

// Paid/subscribed-only route. This is where note-taking, per-timestamp
// summaries, and the AI assistant (the right-sidebar features) will live.
// Access is gated on `isSubscribed`; the route param must match the signed-in
// user so nobody can open someone else's workspace.

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/_comps/providers/AuthProvider";
import { useUI } from "@/_comps/providers/UIprovider";

export default function NotePage() {
  const router = useRouter();
  const params = useParams<{ userId: string }>();
  const { user, loading } = useAuth();
  const { isSubscribed } = useUI();

  const allowed =
    Boolean(user) && isSubscribed && params?.userId === user?.uid;

  useEffect(() => {
    if (loading) return;
    if (!allowed) router.replace("/");
  }, [loading, allowed, router]);

  // Render nothing until we know the user is allowed (avoids a flash of content
  // before the redirect fires).
  if (loading || !allowed) return null;

  return (
    <main className="min-h-screen bg-background text-foreground pt-24 px-4 sm:px-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold">Тэмдэглэл ба хураангуй</h1>
        <p className="text-muted-foreground text-sm">
          Тэмдэглэл, тухайн агшны хураангуй, AI туслах — эдгээр функцууд энд
          нэмэгдэнэ.
        </p>
      </div>
    </main>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/_comps/providers/AuthProvider";

// Нэвтрээгүй хэрэглэгчийг /login руу шилжүүлдэг хамгаалалтын бүрхүүл.
// Хамгаалмаар хуудсаа <RequireAuth>...</RequireAuth>-ээр ороож ашиглана.
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}

"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/AuthContext";
import UserNotRegisteredError from "./UserNotRegisteredError";

export default function ProtectedRoute({
  fallback,
  unauthenticatedElement,
}: {
  fallback?: ReactNode;
  unauthenticatedElement?: ReactNode;
}) {
  const { isAuthenticated, isLoadingAuth, authChecked, authError } = useAuth();

  if (isLoadingAuth || !authChecked) {
    return (
      fallback || (
        <div className="fixed inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
        </div>
      )
    );
  }

  if (authError) {
    if (authError.type === "user_not_registered") {
      return <UserNotRegisteredError />;
    }
    return unauthenticatedElement;
  }

  if (!isAuthenticated) {
    return unauthenticatedElement;
  }

  return null;
}

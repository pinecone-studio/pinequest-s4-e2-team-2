"use client";

import * as React from "react";
import { onAuthStateChanged, type User } from "firebase/auth";

import { logout as firebaseLogout } from "@/lib/auth";
import { getCurrentUser, type UserProfile } from "@/lib/backend-api";
import { firebaseAuth } from "@/lib/firebase";

type AuthContextType = {
  user: User | null;
  backendUser: UserProfile | null;
  loading: boolean;
  authError: string;
  logout: () => Promise<void>;
  refreshUser: () => Promise<UserProfile | null>;
  paid: boolean;
};

const AuthContext = React.createContext<AuthContextType>({
  user: null,
  backendUser: null,
  loading: true,
  authError: "",
  logout: async () => {},
  refreshUser: async () => null,
  paid: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [backendUser, setBackendUser] = React.useState<UserProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [authError, setAuthError] = React.useState("");

  const refreshUser = React.useCallback(async () => {
    const current = firebaseAuth.currentUser;
    if (!current) {
      setBackendUser(null);
      return null;
    }

    const idToken = await current.getIdToken(true);
    let profile: UserProfile;
    try {
      profile = await getCurrentUser(idToken);
    } catch {
      profile = await getCurrentUser();
    }
    setBackendUser(profile);
    return profile;
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      setUser(nextUser);
      setBackendUser(null);
      setAuthError("");

      if (!nextUser) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const idToken = await nextUser.getIdToken();
        let profile: UserProfile;
        try {
          profile = await getCurrentUser(idToken);
        } catch {
          profile = await getCurrentUser();
        }
        if (!cancelled) setBackendUser(profile);
      } catch (error) {
        if (!cancelled) {
          setAuthError(
            error instanceof Error ? error.message : "Backend auth failed.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const logout = React.useCallback(async () => {
    await firebaseLogout();
  }, []);

  const paid = Boolean(backendUser?.is_pro);

  return (
    <AuthContext.Provider
      value={{ user, backendUser, loading, authError, logout, refreshUser, paid }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => React.useContext(AuthContext);

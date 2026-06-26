"use client";

import * as React from "react";
import { onAuthStateChanged, type User } from "firebase/auth";

import { logout as firebaseLogout } from "@/lib/auth";
import { firebaseAuth } from "@/lib/firebase";

type AuthContextType = {
  user: User | null;
  // Firebase эхний auth төлвийг тодорхойлох хүртэлх ачааллын үе.
  loading: boolean;
  logout: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const logout = React.useCallback(async () => {
    await firebaseLogout();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => React.useContext(AuthContext);

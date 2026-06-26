"use client";

import { LogIn, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "@/_comps/providers/ThemeProvider";
import { useAuth } from "@/_comps/providers/AuthProvider";
import { Button } from "@/_comps/ui/Button";

export default function Header({ onSignIn }: { onSignIn: () => void }) {
  const { theme, toggleTheme } = useTheme();
  const { user, loading, logout } = useAuth();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-8 py-4 border-b border-border bg-background/80 backdrop-blur-md">
      {loading ? (
        <div className="w-24 h-9" aria-hidden="true" />
      ) : user ? (
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-sm font-medium text-foreground max-w-[180px] truncate">
            {user.displayName || user.email}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout()}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <LogOut className="w-4 h-4" />
            <span>Гарах</span>
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={onSignIn}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <LogIn className="w-4 h-4" />
          <span>Нэвтрэх</span>
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        className="rounded-full"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? (
          <Sun className="w-5 h-5 text-yellow-400" />
        ) : (
          <Moon className="w-5 h-5 text-slate-600" />
        )}
      </Button>
    </header>
  );
}

"use client";

import { Sun, Moon, LogIn, Tv2 } from "lucide-react";
import { useTheme } from "@/_comps/providers/ThemeProvider";
import { Button } from "@/_comps/ui/Button";

export default function Header({ onSignIn }: { onSignIn: () => void }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-8 py-4 border-b border-border bg-background/80 backdrop-blur-md">
      <Button
        variant="outline"
        size="sm"
        onClick={onSignIn}
        className="flex items-center gap-2 text-sm font-medium"
      >
        <LogIn className="w-4 h-4" />
        <span className="hidden sm:inline">Нэвтрэх</span>
        <span className="sm:hidden">Нэвтрэх</span>
      </Button>

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

"use client";

import Link from "next/link";
import { LogIn, LogOut, Moon, NotebookPen, Sun } from "lucide-react";
import { useTheme } from "@/_comps/providers/ThemeProvider";
import { useAuth } from "@/_comps/providers/AuthProvider";
import { useUI } from "@/_comps/providers/UIprovider";
import { Button } from "@/_comps/ui/Button";
import { useRouter } from "next/navigation";
import SearchBox from "./SearchBox";

export default function Header({
  onSignIn,
  searchbar = false,
}: {
  onSignIn: () => void;
  // When enabled AND a user is signed in, the search box lives here in the
  // header (so pages don't need their own). Off by default.
  searchbar?: boolean;
}) {
  const { theme, toggleTheme } = useTheme();
  const { user, loading, logout } = useAuth();
  const { isSubscribed } = useUI();
  const router = useRouter();
  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-4 sm:px-8 py-4 border-b border-border bg-background/80 backdrop-blur-md">
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
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2 text-sm font-medium"
            onClick={() => router.push(`/dashboard`)}
          >
            Нүүр хуудас
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

      {searchbar && user && (
        <div className="flex flex-1 justify-center">
          <SearchBox UI="header" onSubmit={() => {}} />
        </div>
      )}

      <div>
        {user && isSubscribed ? (
          <Link
            href={`/${user.uid}/note`}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <NotebookPen className="w-4 h-4" />
            <span className="hidden sm:inline">Тэмдэглэл</span>
          </Link>
        ) : (
          <Link
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            href={`/${user?.uid}/note`}
          >
            Про авах
          </Link>
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
      </div>
    </header>
  );
}

"use client";

import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/_comps/ui/Button";
import { Input } from "@/_comps/ui/Input";

function isValidYouTubeUrl(url: string) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/.test(
    url.trim(),
  );
}

export default function SearchBox({
  onSubmit,
}: {
  onSubmit: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("YouTube холбоосоо оруулна уу");
      return;
    }
    if (!isValidYouTubeUrl(url)) {
      setError("Зөвхөн YouTube холбоос оруулна уу");
      return;
    }
    setError("");
    onSubmit(url.trim());
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4">
      <div className="text-center mb-8 space-y-3">
        <p className="text-muted-foreground text-sm sm:text-base max-w-md mx-auto">
          Хэл харгалзахгүй, \n Хэрэгтэй зүйлээ эх хэл дээрээ ав
        </p>
      </div>

      <form onSubmit={handleSubmit} className="relative">
        <div className="flex items-center gap-2 p-2 rounded-2xl border border-border bg-card shadow-lg shadow-black/5 dark:shadow-black/20 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all duration-200">
          <div className="pl-3 flex-shrink-0">
            <svg
              className="w-5 h-5 text-red-500"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
          </div>
          <Input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError("");
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm sm:text-base placeholder:text-muted-foreground/50"
          />
          <Button
            type="submit"
            size="sm"
            className="rounded-xl px-4 sm:px-6 gap-2 font-semibold"
          >
            <span className="hidden sm:inline">Орчуулах</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>

        {error && (
          <p className="mt-2 text-sm text-destructive text-center">{error}</p>
        )}
      </form>

      <p className="text-center text-xs text-muted-foreground mt-4">
        Жишээ: youtube.com/watch?v=... эсвэл youtu.be/...
      </p>
    </div>
  );
}

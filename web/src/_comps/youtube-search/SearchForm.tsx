import { Loader2, Search } from "lucide-react";
import { Button } from "@/_comps/ui/Button";
import { Input } from "@/_comps/ui/Input";

export default function SearchForm({
  query,
  error,
  isSearching,
  onQueryChange,
  onSubmit,
}: {
  query: string;
  error: string;
  isSearching: boolean;
  onQueryChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="relative">
      <div className="flex items-center gap-2 p-2 rounded-2xl border border-border bg-card shadow-lg shadow-black/5 dark:shadow-black/20 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all duration-200">
        <div className="pl-3 flex-shrink-0">
          <Search className="w-5 h-5 text-muted-foreground" />
        </div>
        <Input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Сэдэв, гарчиг, channel, playlist эсвэл YouTube холбоос"
          className="flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm sm:text-base placeholder:text-muted-foreground/50"
        />
        <Button
          type="submit"
          size="sm"
          disabled={isSearching}
          className="rounded-xl px-4 sm:px-6 gap-2 font-semibold"
        >
          {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          <span className="hidden sm:inline">Хайх</span>
        </Button>
      </div>

      {error && <p className="mt-3 text-sm text-destructive text-center">{error}</p>}
    </form>
  );
}

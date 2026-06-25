declare module "yt-search" {
  export type SearchAuthor = {
    name?: string;
    url?: string;
  };

  export type SearchVideo = {
    type?: "video" | "live";
    videoId?: string;
    title?: string;
    description?: string;
    url?: string;
    image?: string;
    thumbnail?: string;
    seconds?: number;
    timestamp?: string;
    ago?: string;
    views?: number;
    author?: SearchAuthor;
  };

  export type SearchChannel = {
    type?: "channel";
    id?: string;
    name?: string;
    title?: string;
    about?: string;
    url?: string;
    image?: string;
    thumbnail?: string;
    videoCount?: number;
    videoCountLabel?: string;
    verified?: boolean;
    subCount?: number;
    subCountLabel?: string;
  };

  export type SearchPlaylist = {
    type?: "list";
    listId?: string;
    title?: string;
    description?: string;
    url?: string;
    image?: string;
    thumbnail?: string;
    videoCount?: number;
    author?: SearchAuthor;
  };

  export type SearchItem = SearchVideo | SearchChannel | SearchPlaylist;

  export type SearchResult = {
    all?: SearchItem[];
    videos: SearchVideo[];
    channels?: SearchChannel[];
    playlists?: SearchPlaylist[];
    live?: SearchVideo[];
  };

  export type SearchOptions = {
    query?: string;
    search?: string;
    pages?: number;
    pageStart?: number;
    pageEnd?: number;
    sp?: string;
    hl?: string;
    gl?: string;
    videoId?: string;
    listId?: string;
    playlistId?: string;
  };

  export default function yts(query: string): Promise<SearchResult>;
  export default function yts(options: SearchOptions): Promise<SearchResult>;
}

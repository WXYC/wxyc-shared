/**
 * Metadata DTOs
 *
 * External metadata enrichment from services like Discogs, Spotify, etc.
 */

/** Album metadata from external sources */
export interface AlbumMetadata {
  album_id: number;
  artwork_url?: string;
  discogs_url?: string;
  discogs_id?: number;
  release_year?: number;
  spotify_url?: string;
  apple_music_url?: string;
  youtube_music_url?: string;
  bandcamp_url?: string;
  soundcloud_url?: string;
  last_fetched?: string;
}

/** Artist metadata from external sources */
export interface ArtistMetadata {
  artist_id: number;
  bio?: string;
  wikipedia_url?: string;
  discogs_url?: string;
  discogs_id?: number;
  image_url?: string;
  last_fetched?: string;
}

/** Metadata fetch request */
export interface MetadataFetchRequest {
  album_id?: number;
  artist_id?: number;
  force_refresh?: boolean;
}

/** Metadata fetch response */
export interface MetadataFetchResponse {
  album?: AlbumMetadata;
  artist?: ArtistMetadata;
  source: MetadataSource;
  cached: boolean;
}

/** Metadata source */
export type MetadataSource = 'discogs' | 'spotify' | 'apple_music' | 'cache' | 'none';

/** Discogs search result */
export interface DiscogsSearchResult {
  id: number;
  title: string;
  year?: number;
  thumb?: string;
  cover_image?: string;
  resource_url: string;
  type: 'release' | 'master' | 'artist';
}

/** Discogs release details */
export interface DiscogsRelease {
  id: number;
  title: string;
  year?: number;
  artists: Array<{ name: string; id: number }>;
  labels: Array<{ name: string; id: number }>;
  genres: string[];
  styles: string[];
  tracklist: Array<{ position: string; title: string; duration?: string }>;
  images?: Array<{ type: string; uri: string; width: number; height: number }>;
}

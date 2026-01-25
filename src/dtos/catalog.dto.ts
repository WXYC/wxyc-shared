/**
 * Catalog DTOs
 *
 * The catalog (library) contains the station's album collection.
 * Types use nested structures matching Drizzle relational queries.
 */

import type { Genre, Format } from './common.dto.js';
import type { RotationBin, RotationInfo } from './rotation.dto.js';

/** Genre entry */
export interface GenreEntry {
  id: number;
  genre_name: Genre;
  code_letters: string;
}

/** Format entry */
export interface FormatEntry {
  id: number;
  format_name: Format;
}

/** Artist with nested genre */
export interface Artist {
  id: number;
  artist_name: string;
  code_letters: string;
  code_artist_number: number;
  genre: GenreEntry;
}

/** Album with nested relations */
export interface Album {
  id: number;
  album_title: string;
  code_number: number;
  label?: string;
  add_date?: string;
  disc_quantity?: number;
  alternate_artist_name?: string;
  plays?: number;
  artist: Artist;
  format: FormatEntry;
}

/** Album search result (includes rotation and fuzzy search scores) */
export interface AlbumSearchResult extends Album {
  rotation?: RotationInfo | null;
  /** Fuzzy search distance (lower = better match) */
  album_dist?: number;
  artist_dist?: number;
}

/** Request to add a new album */
export interface AddAlbumRequest {
  album_title: string;
  artist_name?: string;
  artist_id?: number;
  label: string;
  genre_id: number;
  format_id: number;
  disc_quantity?: number;
  alternate_artist_name?: string;
}

/** Request to add a new artist */
export interface AddArtistRequest {
  artist_name: string;
  code_letters: string;
  genre_id: number;
}

/** Catalog search query parameters */
export interface CatalogSearchParams {
  artist_name?: string;
  album_name?: string;
  n?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

/** Track search result (from Discogs cache, flowsheet, or bin) */
export interface TrackSearchResult {
  track_id?: number;
  title: string;
  position?: string;
  duration?: string;
  album_id?: number;
  album_title: string;
  artist_name: string;
  label?: string;
  rotation_id?: number;
  rotation_bin?: RotationBin;
  source: 'discogs' | 'flowsheet' | 'bin';
}

/** Track search query parameters */
export interface TrackSearchParams {
  song: string;
  artist?: string;
  album?: string;
  label?: string;
  n?: number;
}

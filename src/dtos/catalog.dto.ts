/**
 * Catalog DTOs
 *
 * The catalog (library) contains the station's album collection.
 */

import type { Genre, Format } from './common.dto.js';
import type { RotationBin } from './rotation.dto.js';

/** Artist entry */
export interface Artist {
  id: number;
  artist_name: string;
  code_letters: string;
  code_artist_number: number;
  genre_id: number;
}

/** Artist with genre name (for display) */
export interface ArtistWithGenre extends Artist {
  genre_name: Genre;
}

/** Album entry */
export interface Album {
  id: number;
  artist_id: number;
  album_title: string;
  code_number: number;
  genre_id: number;
  format_id: number;
  label?: string;
  add_date?: string;
  disc_quantity?: number;
  alternate_artist_name?: string;
}

/** Album search result (includes joined fields) */
export interface AlbumSearchResult {
  id: number;
  add_date: string;
  album_title: string;
  artist_name: string;
  code_letters: string;
  code_number: number;
  code_artist_number: number;
  format_name: string;
  genre_name: string;
  label: string;
  // Optional fields from fuzzy search
  album_dist?: number;
  artist_dist?: number;
  // Optional rotation info
  rotation_bin?: RotationBin;
  rotation_id?: number;
  plays?: number;
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
  n?: number; // max results
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

/** Format entry */
export interface FormatEntry {
  id: number;
  format_name: string;
}

/** Genre entry */
export interface GenreEntry {
  id: number;
  genre_name: Genre;
  code_letters: string;
}

/** Album info response (detailed view) */
export interface AlbumInfoResponse extends Album {
  artist_name: string;
  code_letters: string;
  format_name: string;
  genre_name: Genre;
  rotation?: {
    id: number;
    rotation_bin: RotationBin;
    add_date: string;
    kill_date: string | null;
  } | null;
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

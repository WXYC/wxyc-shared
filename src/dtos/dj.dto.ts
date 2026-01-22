/**
 * DJ DTOs
 *
 * DJ-related endpoints for bins, playlists, and user management.
 */

import type { AlbumSearchResult } from './catalog.dto.js';

/** DJ user profile */
export interface DJ {
  id: number;
  dj_name: string;
  real_name?: string;
  email?: string;
}

/** DJ bin entry (saved albums for quick access) */
export interface BinEntry {
  id: number;
  dj_id: number;
  album_id: number;
  added_at: string;
  // Joined album info
  album_title: string;
  artist_name: string;
  code_letters: string;
  code_number: number;
}

/** Request to add an album to DJ bin */
export interface AddToBinRequest {
  album_id: number;
}

/** DJ playlist (saved show playlists) */
export interface Playlist {
  id: number;
  dj_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

/** Playlist with entries */
export interface PlaylistWithEntries extends Playlist {
  entries: PlaylistEntry[];
}

/** Entry in a playlist */
export interface PlaylistEntry {
  id: number;
  playlist_id: number;
  album_id: number;
  track_title?: string;
  position: number;
  // Joined album info
  album_title: string;
  artist_name: string;
}

/** DJ bin response */
export interface DJBinResponse {
  dj_id: number;
  entries: BinEntry[];
}

/** DJ playlists response */
export interface DJPlaylistsResponse {
  dj_id: number;
  playlists: Playlist[];
}

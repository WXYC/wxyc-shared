/**
 * Rotation DTOs
 *
 * Rotation refers to albums that DJs are encouraged to play more frequently.
 */

/** Rotation frequency levels (H=High, M=Medium, L=Low, S=Special) */
export type RotationFrequency = 'H' | 'M' | 'L' | 'S';

/** Rotation entry from the database */
export interface Rotation {
  id: number;
  album_id: number;
  play_freq: RotationFrequency;
  add_date: string;
  kill_date: string | null;
}

/** Request to add an album to rotation */
export interface AddRotationRequest {
  album_id: number;
  play_freq: RotationFrequency;
}

/** Request to kill (end) a rotation */
export interface KillRotationRequest {
  rotation_id: number;
  kill_date?: string; // ISO date string, defaults to today
}

/** Rotation with album details (for display) */
export interface RotationWithAlbum extends Rotation {
  album_title: string;
  artist_name: string;
  code_letters: string;
  code_number: number;
}

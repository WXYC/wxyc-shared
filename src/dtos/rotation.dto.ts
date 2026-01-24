/**
 * Rotation DTOs
 *
 * Rotation refers to albums that DJs are encouraged to play more frequently.
 * Albums in rotation are kept in physical bins labeled H (Heavy), M (Medium),
 * L (Light), and S (Single).
 */

/** Rotation bin levels - corresponds to physical bins: H=Heavy, M=Medium, L=Light, S=Single */
export type RotationBin = 'H' | 'M' | 'L' | 'S';

/** Rotation entry from the database */
export interface RotationEntry {
  id: number;
  album_id: number;
  play_freq: RotationBin;
  add_date: string;
  kill_date: string | null;
}

/** Request to add an album to rotation */
export interface AddRotationRequest {
  album_id: number;
  play_freq: RotationBin;
}

/** Request to kill (end) a rotation */
export interface KillRotationRequest {
  rotation_id: number;
  kill_date?: string; // ISO date string, defaults to today
}

/** Rotation with album details (for display) */
export interface RotationWithAlbum extends RotationEntry {
  album_title: string;
  artist_name: string;
  code_letters: string;
  code_number: number;
}

/**
 * Rotation DTOs
 *
 * Rotation refers to albums that DJs are encouraged to play more frequently.
 * Albums in rotation are kept in physical bins labeled H (Heavy), M (Medium),
 * L (Light), and S (Single).
 *
 * For reading rotation data, use AlbumSearchResult which includes nested rotation info.
 * These types are primarily for write operations.
 */

/** Rotation bin levels - corresponds to physical bins: H=Heavy, M=Medium, L=Light, S=Single */
export type RotationBin = 'H' | 'M' | 'L' | 'S';

/** Rotation info (for nesting in album responses) */
export interface RotationInfo {
  id: number;
  rotation_bin: RotationBin;
  add_date: string;
  kill_date: string | null;
}

/** Rotation database entry (for writes and test fixtures) */
export interface RotationEntry extends RotationInfo {
  album_id: number;
}

/** Request to add an album to rotation */
export interface AddRotationRequest {
  album_id: number;
  rotation_bin: RotationBin;
}

/** Request to kill (end) a rotation */
export interface KillRotationRequest {
  rotation_id: number;
  kill_date?: string; // ISO date string, defaults to today
}

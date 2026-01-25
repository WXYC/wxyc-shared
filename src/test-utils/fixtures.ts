/**
 * Test Fixtures
 *
 * Static test data for common entities.
 */

import type { Artist, Album, AlbumSearchResult, GenreEntry, FormatEntry } from '../dtos/catalog.dto.js';
import type { FlowsheetEntryResponse, FlowsheetSongEntry, OnAirDJ } from '../dtos/flowsheet.dto.js';
import type { RotationEntry, RotationInfo } from '../dtos/rotation.dto.js';
import type { DJ, BinEntry } from '../dtos/dj.dto.js';
import type { ScheduleShift } from '../dtos/schedule.dto.js';

// ============================================================================
// Genres & Formats
// ============================================================================

export const testGenreRock: GenreEntry = {
  id: 2,
  genre_name: 'Rock',
  code_letters: 'RO',
};

export const testGenreJazz: GenreEntry = {
  id: 5,
  genre_name: 'Jazz',
  code_letters: 'JA',
};

export const testFormatVinyl: FormatEntry = {
  id: 1,
  format_name: 'Vinyl',
};

export const testFormatCD: FormatEntry = {
  id: 2,
  format_name: 'CD',
};

// ============================================================================
// Artists
// ============================================================================

export const testArtist: Artist = {
  id: 1,
  artist_name: 'Test Artist',
  code_letters: 'RO',
  code_artist_number: 1,
  genre: testGenreRock,
};

export const testArtist2: Artist = {
  id: 2,
  artist_name: 'Another Artist',
  code_letters: 'JA',
  code_artist_number: 1,
  genre: testGenreJazz,
};

// ============================================================================
// Albums
// ============================================================================

export const testAlbum: Album = {
  id: 1,
  album_title: 'Test Album',
  code_number: 1,
  label: 'Test Label',
  add_date: '2024-01-15',
  artist: testArtist,
  format: testFormatVinyl,
};

export const testAlbum2: Album = {
  id: 2,
  album_title: 'Another Album',
  code_number: 1,
  label: 'Another Label',
  add_date: '2024-02-20',
  artist: testArtist2,
  format: testFormatCD,
};

export const testAlbumSearchResult: AlbumSearchResult = {
  ...testAlbum,
  rotation: null,
};

// ============================================================================
// Flowsheet
// ============================================================================

export const testFlowsheetEntry: FlowsheetEntryResponse = {
  id: 100,
  play_order: 50,
  show_id: 1,
  album_id: 1,
  track_title: 'Test Track',
  album_title: 'Test Album',
  artist_name: 'Test Artist',
  record_label: 'Test Label',
  rotation_id: undefined,
  rotation_bin: null,
  request_flag: false,
};

export const testFlowsheetSongEntry: FlowsheetSongEntry = {
  id: 100,
  play_order: 50,
  show_id: 1,
  track_title: 'Test Track',
  album_title: 'Test Album',
  artist_name: 'Test Artist',
  record_label: 'Test Label',
  request_flag: false,
  album_id: 1,
};

export const testOnAirDJ: OnAirDJ = {
  id: 1,
  dj_name: 'DJ Test',
};

// ============================================================================
// Rotation
// ============================================================================

export const testRotationInfo: RotationInfo = {
  id: 1,
  rotation_bin: 'H',
  add_date: '2024-01-01',
  kill_date: null,
};

export const testRotation: RotationEntry = {
  ...testRotationInfo,
  album_id: 1,
};

// ============================================================================
// DJs
// ============================================================================

export const testDJ: DJ = {
  id: 1,
  dj_name: 'DJ Test',
  real_name: 'Test User',
  email: 'test@wxyc.org',
};

export const testBinEntry: BinEntry = {
  id: 1,
  dj_id: 1,
  album_id: 1,
  added_at: '2024-01-15T12:00:00Z',
  album_title: 'Test Album',
  artist_name: 'Test Artist',
  code_letters: 'RO',
  code_number: 1,
};

// ============================================================================
// Schedule
// ============================================================================

export const testScheduleShift: ScheduleShift = {
  id: 1,
  dj_id: 1,
  dj_name: 'DJ Test',
  day: 'Monday',
  start_time: '14:00',
  end_time: '16:00',
};

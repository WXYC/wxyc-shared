/**
 * Test Fixtures
 *
 * Static test data for common entities.
 */

import type {
  Artist,
  Album,
  AlbumSearchResult,
  FlowsheetEntryResponse,
  FlowsheetSongEntry,
  FlowsheetV2TrackEntry,
  FlowsheetV2ShowStartEntry,
  FlowsheetV2ShowEndEntry,
  FlowsheetV2DJJoinEntry,
  FlowsheetV2DJLeaveEntry,
  FlowsheetV2TalksetEntry,
  FlowsheetV2BreakpointEntry,
  FlowsheetV2MessageEntry,
  Label,
  OnAirDJ,
  RotationEntry,
  DJ,
  BinEntry,
  ScheduleShift,
} from '../dtos/index.js';

// ============================================================================
// Artists
// ============================================================================

export const testArtist: Artist = {
  id: 1,
  artist_name: 'Test Artist',
  code_letters: 'RO',
  code_artist_number: 1,
  genre_id: 2, // Rock
};

export const testArtist2: Artist = {
  id: 2,
  artist_name: 'Another Artist',
  code_letters: 'JA',
  code_artist_number: 1,
  genre_id: 5, // Jazz
};

// ============================================================================
// Labels
// ============================================================================

export const testLabel: Label = {
  id: 1,
  label_name: 'Test Label',
};

export const testLabel2: Label = {
  id: 2,
  label_name: 'Another Label',
  parent_label_id: 1,
};

// ============================================================================
// Albums
// ============================================================================

export const testAlbum: Album = {
  id: 1,
  artist_id: 1,
  album_title: 'Test Album',
  code_number: 1,
  genre_id: 2,
  format_id: 1,
  label: 'Test Label',
  label_id: 1,
  add_date: new Date('2024-01-15'),
};

export const testAlbum2: Album = {
  id: 2,
  artist_id: 2,
  album_title: 'Another Album',
  code_number: 1,
  genre_id: 5,
  format_id: 2,
  label: 'Another Label',
  label_id: 2,
  add_date: new Date('2024-02-20'),
};

export const testAlbumSearchResult: AlbumSearchResult = {
  id: 1,
  add_date: new Date('2024-01-15'),
  album_title: 'Test Album',
  artist_name: 'Test Artist',
  code_letters: 'RO',
  code_number: 1,
  code_artist_number: 1,
  format_name: 'Vinyl',
  genre_name: 'Rock',
  label: 'Test Label',
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
  rotation_bin: undefined,
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
// Flowsheet V2
// ============================================================================

const testV2AddTime = new Date('2024-06-15T14:30:00.000Z');

export const testV2TrackEntry: FlowsheetV2TrackEntry = {
  id: 100,
  show_id: 1,
  play_order: 50,
  add_time: testV2AddTime,
  entry_type: 'track',
  album_id: 1,
  rotation_id: 5001,
  artist_name: 'Test Artist',
  album_title: 'Test Album',
  track_title: 'Test Track',
  record_label: 'Test Label',
  request_flag: false,
  rotation_bin: 'H',
};

export const testV2ShowStartEntry: FlowsheetV2ShowStartEntry = {
  id: 101,
  show_id: 1,
  play_order: 1,
  add_time: testV2AddTime,
  entry_type: 'show_start',
  dj_name: 'DJ Test',
  timestamp: testV2AddTime,
};

export const testV2ShowEndEntry: FlowsheetV2ShowEndEntry = {
  id: 102,
  show_id: 1,
  play_order: 200,
  add_time: testV2AddTime,
  entry_type: 'show_end',
  dj_name: 'DJ Test',
  timestamp: testV2AddTime,
};

export const testV2DJJoinEntry: FlowsheetV2DJJoinEntry = {
  id: 103,
  show_id: 1,
  play_order: 10,
  add_time: testV2AddTime,
  entry_type: 'dj_join',
  dj_name: 'DJ Guest',
};

export const testV2DJLeaveEntry: FlowsheetV2DJLeaveEntry = {
  id: 104,
  show_id: 1,
  play_order: 190,
  add_time: testV2AddTime,
  entry_type: 'dj_leave',
  dj_name: 'DJ Guest',
};

export const testV2TalksetEntry: FlowsheetV2TalksetEntry = {
  id: 105,
  show_id: 1,
  play_order: 60,
  add_time: testV2AddTime,
  entry_type: 'talkset',
  message: 'Talkset - station ID',
};

export const testV2BreakpointEntry: FlowsheetV2BreakpointEntry = {
  id: 106,
  show_id: 1,
  play_order: 100,
  add_time: testV2AddTime,
  entry_type: 'breakpoint',
  message: 'Breakpoint - 3:00 PM',
};

export const testV2MessageEntry: FlowsheetV2MessageEntry = {
  id: 107,
  show_id: 1,
  play_order: 70,
  add_time: testV2AddTime,
  entry_type: 'message',
  message: 'Listener shout-out to Chapel Hill',
};

// ============================================================================
// Rotation
// ============================================================================

export const testRotation: RotationEntry = {
  id: 1,
  album_id: 1,
  rotation_bin: 'H',
  add_date: new Date('2024-01-01'),
  kill_date: null,
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
  added_at: new Date('2024-01-15T12:00:00Z'),
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

/**
 * Test Factories
 *
 * Factory functions for creating test data with custom overrides.
 */

import type {
  Artist,
  Album,
  AlbumSearchResult,
  FlowsheetEntryResponse,
  FlowsheetSongEntry,
  FlowsheetPostRequest,
  FlowsheetV2TrackEntry,
  FlowsheetV2ShowStartEntry,
  FlowsheetV2ShowEndEntry,
  FlowsheetV2DJJoinEntry,
  FlowsheetV2DJLeaveEntry,
  FlowsheetV2TalksetEntry,
  FlowsheetV2BreakpointEntry,
  FlowsheetV2MessageEntry,
  RotationEntry,
  DJ,
  BinEntry,
  ScheduleShift,
  DayOfWeek,
  SongRequest,
  ParsedSongRequest,
} from '../dtos/index.js';

import type { FlowsheetV2Entry } from '../dtos/extensions.js';

import {
  testArtist,
  testAlbum,
  testAlbumSearchResult,
  testFlowsheetEntry,
  testFlowsheetSongEntry,
  testV2TrackEntry,
  testV2ShowStartEntry,
  testV2ShowEndEntry,
  testV2DJJoinEntry,
  testV2DJLeaveEntry,
  testV2TalksetEntry,
  testV2BreakpointEntry,
  testV2MessageEntry,
  testRotation,
  testDJ,
  testBinEntry,
  testScheduleShift,
} from './fixtures.js';

// ============================================================================
// ID Generators
// ============================================================================

let idCounter = 1000;

/** Generate a unique ID for test data */
export function generateId(): number {
  return idCounter++;
}

/** Reset the ID counter (call in beforeEach) */
export function resetIdCounter(): void {
  idCounter = 1000;
}

// ============================================================================
// Artists
// ============================================================================

export function createTestArtist(overrides: Partial<Artist> = {}): Artist {
  return {
    ...testArtist,
    id: generateId(),
    ...overrides,
  };
}

// ============================================================================
// Albums
// ============================================================================

export function createTestAlbum(overrides: Partial<Album> = {}): Album {
  return {
    ...testAlbum,
    id: generateId(),
    ...overrides,
  };
}

export function createTestAlbumSearchResult(
  overrides: Partial<AlbumSearchResult> = {}
): AlbumSearchResult {
  return {
    ...testAlbumSearchResult,
    id: generateId(),
    ...overrides,
  };
}

// ============================================================================
// Flowsheet
// ============================================================================

export function createTestFlowsheetEntry(
  overrides: Partial<FlowsheetEntryResponse> = {}
): FlowsheetEntryResponse {
  return {
    ...testFlowsheetEntry,
    id: generateId(),
    play_order: generateId(),
    ...overrides,
  };
}

export function createTestFlowsheetSongEntry(
  overrides: Partial<FlowsheetSongEntry> = {}
): FlowsheetSongEntry {
  return {
    ...testFlowsheetSongEntry,
    id: generateId(),
    play_order: generateId(),
    ...overrides,
  };
}

export function createFlowsheetPostRequest(
  type: 'catalog' | 'freeform' | 'message',
  overrides: Partial<FlowsheetPostRequest> = {}
): FlowsheetPostRequest {
  switch (type) {
    case 'catalog':
      return {
        album_id: 1,
        track_title: 'Test Track',
        request_flag: false,
        ...overrides,
      } as FlowsheetPostRequest;
    case 'freeform':
      return {
        artist_name: 'Test Artist',
        album_title: 'Test Album',
        track_title: 'Test Track',
        request_flag: false,
        ...overrides,
      } as FlowsheetPostRequest;
    case 'message':
      return {
        message: 'Test message',
        ...overrides,
      } as FlowsheetPostRequest;
  }
}

// ============================================================================
// Flowsheet V2
// ============================================================================

export function createTestV2TrackEntry(
  overrides: Partial<FlowsheetV2TrackEntry> = {}
): FlowsheetV2TrackEntry {
  return {
    ...testV2TrackEntry,
    id: generateId(),
    play_order: generateId(),
    ...overrides,
  };
}

export function createTestV2ShowStartEntry(
  overrides: Partial<FlowsheetV2ShowStartEntry> = {}
): FlowsheetV2ShowStartEntry {
  return {
    ...testV2ShowStartEntry,
    id: generateId(),
    play_order: generateId(),
    ...overrides,
  };
}

export function createTestV2ShowEndEntry(
  overrides: Partial<FlowsheetV2ShowEndEntry> = {}
): FlowsheetV2ShowEndEntry {
  return {
    ...testV2ShowEndEntry,
    id: generateId(),
    play_order: generateId(),
    ...overrides,
  };
}

export function createTestV2DJJoinEntry(
  overrides: Partial<FlowsheetV2DJJoinEntry> = {}
): FlowsheetV2DJJoinEntry {
  return {
    ...testV2DJJoinEntry,
    id: generateId(),
    play_order: generateId(),
    ...overrides,
  };
}

export function createTestV2DJLeaveEntry(
  overrides: Partial<FlowsheetV2DJLeaveEntry> = {}
): FlowsheetV2DJLeaveEntry {
  return {
    ...testV2DJLeaveEntry,
    id: generateId(),
    play_order: generateId(),
    ...overrides,
  };
}

export function createTestV2TalksetEntry(
  overrides: Partial<FlowsheetV2TalksetEntry> = {}
): FlowsheetV2TalksetEntry {
  return {
    ...testV2TalksetEntry,
    id: generateId(),
    play_order: generateId(),
    ...overrides,
  };
}

export function createTestV2BreakpointEntry(
  overrides: Partial<FlowsheetV2BreakpointEntry> = {}
): FlowsheetV2BreakpointEntry {
  return {
    ...testV2BreakpointEntry,
    id: generateId(),
    play_order: generateId(),
    ...overrides,
  };
}

export function createTestV2MessageEntry(
  overrides: Partial<FlowsheetV2MessageEntry> = {}
): FlowsheetV2MessageEntry {
  return {
    ...testV2MessageEntry,
    id: generateId(),
    play_order: generateId(),
    ...overrides,
  };
}

// ============================================================================
// Rotation
// ============================================================================

export function createTestRotation(overrides: Partial<RotationEntry> = {}): RotationEntry {
  return {
    ...testRotation,
    id: generateId(),
    ...overrides,
  };
}

// ============================================================================
// DJs
// ============================================================================

export function createTestDJ(overrides: Partial<DJ> = {}): DJ {
  return {
    ...testDJ,
    id: generateId(),
    ...overrides,
  };
}

export function createTestBinEntry(overrides: Partial<BinEntry> = {}): BinEntry {
  return {
    ...testBinEntry,
    id: generateId(),
    ...overrides,
  };
}

// ============================================================================
// Schedule
// ============================================================================

export function createTestScheduleShift(
  overrides: Partial<ScheduleShift> = {}
): ScheduleShift {
  return {
    ...testScheduleShift,
    id: generateId(),
    ...overrides,
  };
}

// ============================================================================
// Requests
// ============================================================================

export function createTestSongRequest(
  overrides: Partial<SongRequest> = {}
): SongRequest {
  return {
    id: generateId(),
    device_id: `device-${generateId()}`,
    message: 'Play some jazz please',
    created_at: new Date(),
    status: 'pending',
    ...overrides,
  };
}

export function createTestParsedRequest(
  overrides: Partial<ParsedSongRequest> = {}
): ParsedSongRequest {
  return {
    artist: 'Miles Davis',
    song: 'So What',
    album: 'Kind of Blue',
    confidence: 0.95,
    ...overrides,
  };
}

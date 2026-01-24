/**
 * Test Factories
 *
 * Factory functions for creating test data with custom overrides.
 */

import type { Artist, Album, AlbumSearchResult } from '../dtos/catalog.dto.js';
import type { FlowsheetEntryResponse, FlowsheetSongEntry, FlowsheetCreateRequest } from '../dtos/flowsheet.dto.js';
import type { RotationEntry } from '../dtos/rotation.dto.js';
import type { DJ, BinEntry } from '../dtos/dj.dto.js';
import type { ScheduleShift, DayOfWeek } from '../dtos/schedule.dto.js';
import type { SongRequest, ParsedSongRequest } from '../dtos/request.dto.js';

import {
  testArtist,
  testAlbum,
  testAlbumSearchResult,
  testFlowsheetEntry,
  testFlowsheetSongEntry,
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

export function createFlowsheetCreateRequest(
  type: 'catalog' | 'freeform' | 'message',
  overrides: Partial<FlowsheetCreateRequest> = {}
): FlowsheetCreateRequest {
  switch (type) {
    case 'catalog':
      return {
        album_id: 1,
        track_title: 'Test Track',
        request_flag: false,
        ...overrides,
      } as FlowsheetCreateRequest;
    case 'freeform':
      return {
        artist_name: 'Test Artist',
        album_title: 'Test Album',
        track_title: 'Test Track',
        request_flag: false,
        ...overrides,
      } as FlowsheetCreateRequest;
    case 'message':
      return {
        message: 'Test message',
        ...overrides,
      } as FlowsheetCreateRequest;
  }
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
    created_at: new Date().toISOString(),
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

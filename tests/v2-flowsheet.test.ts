/**
 * Tests for V2 Flowsheet Types and Type Guards
 *
 * Validates:
 * - Generated V2 types accept valid object literals
 * - Discriminator-based type guards narrow correctly
 * - FlowsheetEntryType enum has all expected values
 */

import { describe, it, expect } from 'vitest';
import {
  FlowsheetEntryType,
  type FlowsheetV2TrackEntry,
  type FlowsheetV2ShowStartEntry,
  type FlowsheetV2ShowEndEntry,
  type FlowsheetV2DJJoinEntry,
  type FlowsheetV2DJLeaveEntry,
  type FlowsheetV2TalksetEntry,
  type FlowsheetV2BreakpointEntry,
  type FlowsheetV2MessageEntry,
  type FlowsheetV2PaginatedResponse,
  RotationBin,
} from '../src/generated/models/index.js';
import {
  isV2TrackEntry,
  isV2ShowStartEntry,
  isV2ShowEndEntry,
  isV2DJJoinEntry,
  isV2DJLeaveEntry,
  isV2TalksetEntry,
  isV2BreakpointEntry,
  isV2MessageEntry,
  type FlowsheetV2Entry,
} from '../src/dtos/extensions.js';

// =============================================================================
// Test Data
// =============================================================================

const baseFields = {
  id: 1,
  show_id: 42,
  play_order: 100,
  add_time: '2024-06-15T14:30:00.000Z',
};

const sampleTrack: FlowsheetV2TrackEntry = {
  ...baseFields,
  entry_type: 'track',
  artist_name: 'Radiohead',
  album_title: 'OK Computer',
  track_title: 'Paranoid Android',
  record_label: 'Parlophone',
  request_flag: false,
  rotation_bin: 'H',
  album_id: 1001,
  rotation_id: 5001,
  artwork_url: 'https://example.com/art.jpg',
  spotify_url: 'https://open.spotify.com/track/abc',
};

const sampleShowStart: FlowsheetV2ShowStartEntry = {
  ...baseFields,
  entry_type: 'show_start',
  dj_name: 'DJ Cool',
  timestamp: '2024-06-15T14:00:00.000Z',
};

const sampleShowEnd: FlowsheetV2ShowEndEntry = {
  ...baseFields,
  entry_type: 'show_end',
  dj_name: 'DJ Cool',
  timestamp: '2024-06-15T16:00:00.000Z',
};

const sampleDJJoin: FlowsheetV2DJJoinEntry = {
  ...baseFields,
  entry_type: 'dj_join',
  dj_name: 'DJ Guest',
};

const sampleDJLeave: FlowsheetV2DJLeaveEntry = {
  ...baseFields,
  entry_type: 'dj_leave',
  dj_name: 'DJ Guest',
};

const sampleTalkset: FlowsheetV2TalksetEntry = {
  ...baseFields,
  entry_type: 'talkset',
  message: 'Talkset - station ID',
};

const sampleBreakpoint: FlowsheetV2BreakpointEntry = {
  ...baseFields,
  entry_type: 'breakpoint',
  message: 'Breakpoint - 3:00 PM',
};

const sampleMessage: FlowsheetV2MessageEntry = {
  ...baseFields,
  entry_type: 'message',
  message: 'Shout-out to Chapel Hill',
};

// =============================================================================
// FlowsheetEntryType Enum
// =============================================================================

describe('FlowsheetEntryType', () => {
  it.each([
    'track',
    'show_start',
    'show_end',
    'dj_join',
    'dj_leave',
    'talkset',
    'breakpoint',
    'message',
  ])('should include "%s"', (value) => {
    expect(Object.values(FlowsheetEntryType)).toContain(value);
  });

  it('should have exactly 8 values', () => {
    expect(Object.keys(FlowsheetEntryType)).toHaveLength(8);
  });
});

// =============================================================================
// V2 Type Structure Tests
// =============================================================================

describe('V2 Generated Types', () => {
  describe('FlowsheetV2TrackEntry', () => {
    it('should accept a valid track entry', () => {
      expect(sampleTrack.entry_type).toBe('track');
      expect(sampleTrack.artist_name).toBe('Radiohead');
      expect(sampleTrack.track_title).toBe('Paranoid Android');
      expect(sampleTrack.rotation_bin).toBe(RotationBin.H);
      expect(sampleTrack.request_flag).toBe(false);
      expect(typeof sampleTrack.add_time).toBe('string');
    });

    it('should allow nullable metadata fields', () => {
      const entry: FlowsheetV2TrackEntry = {
        ...baseFields,
        entry_type: 'track',
        artist_name: 'Test',
        album_title: 'Test',
        track_title: 'Test',
        record_label: 'Test',
        request_flag: false,
        artwork_url: null,
        spotify_url: null,
        release_year: null,
        artist_bio: null,
      };

      expect(entry.artwork_url).toBeNull();
      expect(entry.spotify_url).toBeNull();
    });

    it('should allow nullable show_id', () => {
      const entry: FlowsheetV2TrackEntry = {
        ...sampleTrack,
        show_id: null,
      };

      expect(entry.show_id).toBeNull();
    });
  });

  describe('FlowsheetV2ShowStartEntry', () => {
    it('should accept a valid show start entry', () => {
      expect(sampleShowStart.entry_type).toBe('show_start');
      expect(sampleShowStart.dj_name).toBe('DJ Cool');
      expect(typeof sampleShowStart.timestamp).toBe('string');
    });
  });

  describe('FlowsheetV2ShowEndEntry', () => {
    it('should accept a valid show end entry', () => {
      expect(sampleShowEnd.entry_type).toBe('show_end');
      expect(sampleShowEnd.dj_name).toBe('DJ Cool');
      expect(typeof sampleShowEnd.timestamp).toBe('string');
    });
  });

  describe('FlowsheetV2DJJoinEntry', () => {
    it('should accept a valid DJ join entry', () => {
      expect(sampleDJJoin.entry_type).toBe('dj_join');
      expect(sampleDJJoin.dj_name).toBe('DJ Guest');
    });
  });

  describe('FlowsheetV2DJLeaveEntry', () => {
    it('should accept a valid DJ leave entry', () => {
      expect(sampleDJLeave.entry_type).toBe('dj_leave');
      expect(sampleDJLeave.dj_name).toBe('DJ Guest');
    });
  });

  describe('FlowsheetV2TalksetEntry', () => {
    it('should accept a valid talkset entry', () => {
      expect(sampleTalkset.entry_type).toBe('talkset');
      expect(sampleTalkset.message).toBe('Talkset - station ID');
    });
  });

  describe('FlowsheetV2BreakpointEntry', () => {
    it('should accept a valid breakpoint entry', () => {
      expect(sampleBreakpoint.entry_type).toBe('breakpoint');
      expect(sampleBreakpoint.message).toBe('Breakpoint - 3:00 PM');
    });
  });

  describe('FlowsheetV2MessageEntry', () => {
    it('should accept a valid message entry', () => {
      expect(sampleMessage.entry_type).toBe('message');
      expect(sampleMessage.message).toBe('Shout-out to Chapel Hill');
    });
  });
});

// =============================================================================
// V2 Type Guards
// =============================================================================

describe('V2 Type Guards', () => {
  const entries: Array<{ entry: FlowsheetV2Entry; type: string }> = [
    { entry: sampleTrack, type: 'track' },
    { entry: sampleShowStart, type: 'show_start' },
    { entry: sampleShowEnd, type: 'show_end' },
    { entry: sampleDJJoin, type: 'dj_join' },
    { entry: sampleDJLeave, type: 'dj_leave' },
    { entry: sampleTalkset, type: 'talkset' },
    { entry: sampleBreakpoint, type: 'breakpoint' },
    { entry: sampleMessage, type: 'message' },
  ];

  const guards: Array<{
    name: string;
    guard: (e: FlowsheetV2Entry) => boolean;
    matchType: string;
  }> = [
    { name: 'isV2TrackEntry', guard: isV2TrackEntry, matchType: 'track' },
    { name: 'isV2ShowStartEntry', guard: isV2ShowStartEntry, matchType: 'show_start' },
    { name: 'isV2ShowEndEntry', guard: isV2ShowEndEntry, matchType: 'show_end' },
    { name: 'isV2DJJoinEntry', guard: isV2DJJoinEntry, matchType: 'dj_join' },
    { name: 'isV2DJLeaveEntry', guard: isV2DJLeaveEntry, matchType: 'dj_leave' },
    { name: 'isV2TalksetEntry', guard: isV2TalksetEntry, matchType: 'talkset' },
    { name: 'isV2BreakpointEntry', guard: isV2BreakpointEntry, matchType: 'breakpoint' },
    { name: 'isV2MessageEntry', guard: isV2MessageEntry, matchType: 'message' },
  ];

  describe.each(guards)('$name', ({ guard, matchType }) => {
    it.each(entries)(
      `should return ${matchType === '$type' ? 'true' : 'false'} for $type entry`,
      ({ entry, type }) => {
        expect(guard(entry)).toBe(type === matchType);
      }
    );
  });
});

// =============================================================================
// Paginated Response
// =============================================================================

describe('FlowsheetV2PaginatedResponse', () => {
  it('should accept a valid paginated response', () => {
    const response: FlowsheetV2PaginatedResponse = {
      entries: [sampleTrack, sampleShowStart, sampleBreakpoint, sampleMessage],
      page: 0,
      limit: 30,
      total: 150,
      totalPages: 5,
    };

    expect(response.entries).toHaveLength(4);
    expect(response.page).toBe(0);
    expect(response.limit).toBe(30);
    expect(response.total).toBe(150);
    expect(response.totalPages).toBe(5);
  });

  it('should allow type guards on entries', () => {
    const response: FlowsheetV2PaginatedResponse = {
      entries: [sampleTrack, sampleShowStart, sampleBreakpoint, sampleMessage],
      page: 0,
      limit: 30,
      total: 150,
      totalPages: 5,
    };

    const entries = response.entries as unknown as FlowsheetV2Entry[];

    expect(isV2TrackEntry(entries[0])).toBe(true);
    expect(isV2ShowStartEntry(entries[1])).toBe(true);
    expect(isV2BreakpointEntry(entries[2])).toBe(true);
    expect(isV2MessageEntry(entries[3])).toBe(true);
  });

  it('should handle empty entries array', () => {
    const response: FlowsheetV2PaginatedResponse = {
      entries: [],
      page: 0,
      limit: 30,
      total: 0,
      totalPages: 0,
    };

    expect(response.entries).toHaveLength(0);
    expect(response.total).toBe(0);
  });
});

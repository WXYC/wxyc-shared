/**
 * Tests for V2 Flowsheet Types and Type Guards
 *
 * Validates:
 * - Generated V2 types round-trip through FromJSON/ToJSON
 * - Discriminator-based type guards narrow correctly
 * - FlowsheetEntryType enum has all expected values
 * - PaginatedResponse wrapper deserializes entries via discriminator
 */

import { describe, it, expect } from 'vitest';
import {
  FlowsheetEntryType,
  FlowsheetV2TrackEntry,
  FlowsheetV2TrackEntryFromJSON,
  FlowsheetV2TrackEntryToJSON,
  FlowsheetV2ShowStartEntry,
  FlowsheetV2ShowStartEntryFromJSON,
  FlowsheetV2ShowStartEntryToJSON,
  FlowsheetV2ShowEndEntry,
  FlowsheetV2ShowEndEntryFromJSON,
  FlowsheetV2ShowEndEntryToJSON,
  FlowsheetV2DJJoinEntry,
  FlowsheetV2DJJoinEntryFromJSON,
  FlowsheetV2DJJoinEntryToJSON,
  FlowsheetV2DJLeaveEntry,
  FlowsheetV2DJLeaveEntryFromJSON,
  FlowsheetV2DJLeaveEntryToJSON,
  FlowsheetV2TalksetEntry,
  FlowsheetV2TalksetEntryFromJSON,
  FlowsheetV2TalksetEntryToJSON,
  FlowsheetV2BreakpointEntry,
  FlowsheetV2BreakpointEntryFromJSON,
  FlowsheetV2BreakpointEntryToJSON,
  FlowsheetV2MessageEntry,
  FlowsheetV2MessageEntryFromJSON,
  FlowsheetV2MessageEntryToJSON,
  FlowsheetV2PaginatedResponse,
  FlowsheetV2PaginatedResponseFromJSON,
  FlowsheetV2PaginatedResponseToJSON,
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

const sampleTrack = {
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

const sampleShowStart = {
  ...baseFields,
  entry_type: 'show_start',
  dj_name: 'DJ Cool',
  timestamp: '2024-06-15T14:00:00.000Z',
};

const sampleShowEnd = {
  ...baseFields,
  entry_type: 'show_end',
  dj_name: 'DJ Cool',
  timestamp: '2024-06-15T16:00:00.000Z',
};

const sampleDJJoin = {
  ...baseFields,
  entry_type: 'dj_join',
  dj_name: 'DJ Guest',
};

const sampleDJLeave = {
  ...baseFields,
  entry_type: 'dj_leave',
  dj_name: 'DJ Guest',
};

const sampleTalkset = {
  ...baseFields,
  entry_type: 'talkset',
  message: 'Talkset - station ID',
};

const sampleBreakpoint = {
  ...baseFields,
  entry_type: 'breakpoint',
  message: 'Breakpoint - 3:00 PM',
};

const sampleMessage = {
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
// Round-trip JSON Tests (FromJSON -> ToJSON -> FromJSON)
// =============================================================================

describe('V2 Generated Types - JSON Round-trip', () => {
  describe('FlowsheetV2TrackEntry', () => {
    it('should parse from JSON', () => {
      const entry = FlowsheetV2TrackEntryFromJSON(sampleTrack);

      expect(entry.id).toBe(1);
      expect(entry.entry_type).toBe('track');
      expect(entry.artist_name).toBe('Radiohead');
      expect(entry.track_title).toBe('Paranoid Android');
      expect(entry.rotation_bin).toBe(RotationBin.H);
      expect(entry.request_flag).toBe(false);
      expect(entry.add_time).toBeInstanceOf(Date);
    });

    it('should round-trip through JSON', () => {
      const entry = FlowsheetV2TrackEntryFromJSON(sampleTrack);
      const json = FlowsheetV2TrackEntryToJSON(entry);
      const roundTrip = FlowsheetV2TrackEntryFromJSON(json);

      expect(roundTrip.id).toBe(entry.id);
      expect(roundTrip.entry_type).toBe('track');
      expect(roundTrip.artist_name).toBe(entry.artist_name);
      expect(roundTrip.rotation_bin).toBe(entry.rotation_bin);
    });

    it('should handle nullable metadata fields', () => {
      const entry = FlowsheetV2TrackEntryFromJSON({
        ...sampleTrack,
        artwork_url: null,
        spotify_url: null,
        release_year: null,
        artist_bio: null,
      });

      expect(entry.artwork_url).toBeUndefined();
      expect(entry.spotify_url).toBeUndefined();
      expect(entry.release_year).toBeUndefined();
      expect(entry.artist_bio).toBeUndefined();
    });

    it('should handle nullable show_id', () => {
      const entry = FlowsheetV2TrackEntryFromJSON({
        ...sampleTrack,
        show_id: null,
      });

      expect(entry.show_id).toBeNull();
    });
  });

  describe('FlowsheetV2ShowStartEntry', () => {
    it('should parse from JSON', () => {
      const entry = FlowsheetV2ShowStartEntryFromJSON(sampleShowStart);

      expect(entry.entry_type).toBe('show_start');
      expect(entry.dj_name).toBe('DJ Cool');
      expect(entry.timestamp).toBeInstanceOf(Date);
    });

    it('should round-trip through JSON', () => {
      const entry = FlowsheetV2ShowStartEntryFromJSON(sampleShowStart);
      const json = FlowsheetV2ShowStartEntryToJSON(entry);
      const roundTrip = FlowsheetV2ShowStartEntryFromJSON(json);

      expect(roundTrip.entry_type).toBe('show_start');
      expect(roundTrip.dj_name).toBe(entry.dj_name);
    });
  });

  describe('FlowsheetV2ShowEndEntry', () => {
    it('should parse from JSON', () => {
      const entry = FlowsheetV2ShowEndEntryFromJSON(sampleShowEnd);

      expect(entry.entry_type).toBe('show_end');
      expect(entry.dj_name).toBe('DJ Cool');
      expect(entry.timestamp).toBeInstanceOf(Date);
    });

    it('should round-trip through JSON', () => {
      const entry = FlowsheetV2ShowEndEntryFromJSON(sampleShowEnd);
      const json = FlowsheetV2ShowEndEntryToJSON(entry);
      const roundTrip = FlowsheetV2ShowEndEntryFromJSON(json);

      expect(roundTrip.entry_type).toBe('show_end');
      expect(roundTrip.dj_name).toBe(entry.dj_name);
    });
  });

  describe('FlowsheetV2DJJoinEntry', () => {
    it('should parse from JSON', () => {
      const entry = FlowsheetV2DJJoinEntryFromJSON(sampleDJJoin);

      expect(entry.entry_type).toBe('dj_join');
      expect(entry.dj_name).toBe('DJ Guest');
    });

    it('should round-trip through JSON', () => {
      const entry = FlowsheetV2DJJoinEntryFromJSON(sampleDJJoin);
      const json = FlowsheetV2DJJoinEntryToJSON(entry);
      const roundTrip = FlowsheetV2DJJoinEntryFromJSON(json);

      expect(roundTrip.entry_type).toBe('dj_join');
      expect(roundTrip.dj_name).toBe(entry.dj_name);
    });
  });

  describe('FlowsheetV2DJLeaveEntry', () => {
    it('should parse from JSON', () => {
      const entry = FlowsheetV2DJLeaveEntryFromJSON(sampleDJLeave);

      expect(entry.entry_type).toBe('dj_leave');
      expect(entry.dj_name).toBe('DJ Guest');
    });

    it('should round-trip through JSON', () => {
      const entry = FlowsheetV2DJLeaveEntryFromJSON(sampleDJLeave);
      const json = FlowsheetV2DJLeaveEntryToJSON(entry);
      const roundTrip = FlowsheetV2DJLeaveEntryFromJSON(json);

      expect(roundTrip.entry_type).toBe('dj_leave');
      expect(roundTrip.dj_name).toBe(entry.dj_name);
    });
  });

  describe('FlowsheetV2TalksetEntry', () => {
    it('should parse from JSON', () => {
      const entry = FlowsheetV2TalksetEntryFromJSON(sampleTalkset);

      expect(entry.entry_type).toBe('talkset');
      expect(entry.message).toBe('Talkset - station ID');
    });

    it('should round-trip through JSON', () => {
      const entry = FlowsheetV2TalksetEntryFromJSON(sampleTalkset);
      const json = FlowsheetV2TalksetEntryToJSON(entry);
      const roundTrip = FlowsheetV2TalksetEntryFromJSON(json);

      expect(roundTrip.entry_type).toBe('talkset');
      expect(roundTrip.message).toBe(entry.message);
    });
  });

  describe('FlowsheetV2BreakpointEntry', () => {
    it('should parse from JSON', () => {
      const entry = FlowsheetV2BreakpointEntryFromJSON(sampleBreakpoint);

      expect(entry.entry_type).toBe('breakpoint');
      expect(entry.message).toBe('Breakpoint - 3:00 PM');
    });

    it('should handle null message', () => {
      const entry = FlowsheetV2BreakpointEntryFromJSON({
        ...baseFields,
        entry_type: 'breakpoint',
        message: null,
      });

      expect(entry.entry_type).toBe('breakpoint');
      expect(entry.message).toBeUndefined();
    });

    it('should round-trip through JSON', () => {
      const entry = FlowsheetV2BreakpointEntryFromJSON(sampleBreakpoint);
      const json = FlowsheetV2BreakpointEntryToJSON(entry);
      const roundTrip = FlowsheetV2BreakpointEntryFromJSON(json);

      expect(roundTrip.entry_type).toBe('breakpoint');
      expect(roundTrip.message).toBe(entry.message);
    });
  });

  describe('FlowsheetV2MessageEntry', () => {
    it('should parse from JSON', () => {
      const entry = FlowsheetV2MessageEntryFromJSON(sampleMessage);

      expect(entry.entry_type).toBe('message');
      expect(entry.message).toBe('Shout-out to Chapel Hill');
    });

    it('should round-trip through JSON', () => {
      const entry = FlowsheetV2MessageEntryFromJSON(sampleMessage);
      const json = FlowsheetV2MessageEntryToJSON(entry);
      const roundTrip = FlowsheetV2MessageEntryFromJSON(json);

      expect(roundTrip.entry_type).toBe('message');
      expect(roundTrip.message).toBe(entry.message);
    });
  });
});

// =============================================================================
// V2 Type Guards
// =============================================================================

describe('V2 Type Guards', () => {
  const entries: Array<{ entry: FlowsheetV2Entry; type: string }> = [
    { entry: FlowsheetV2TrackEntryFromJSON(sampleTrack), type: 'track' },
    { entry: FlowsheetV2ShowStartEntryFromJSON(sampleShowStart), type: 'show_start' },
    { entry: FlowsheetV2ShowEndEntryFromJSON(sampleShowEnd), type: 'show_end' },
    { entry: FlowsheetV2DJJoinEntryFromJSON(sampleDJJoin), type: 'dj_join' },
    { entry: FlowsheetV2DJLeaveEntryFromJSON(sampleDJLeave), type: 'dj_leave' },
    { entry: FlowsheetV2TalksetEntryFromJSON(sampleTalkset), type: 'talkset' },
    { entry: FlowsheetV2BreakpointEntryFromJSON(sampleBreakpoint), type: 'breakpoint' },
    { entry: FlowsheetV2MessageEntryFromJSON(sampleMessage), type: 'message' },
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
  const paginatedJson = {
    entries: [sampleTrack, sampleShowStart, sampleBreakpoint, sampleMessage],
    page: 0,
    limit: 30,
    total: 150,
    totalPages: 5,
  };

  it('should parse paginated response with mixed entry types', () => {
    const response = FlowsheetV2PaginatedResponseFromJSON(paginatedJson);

    expect(response.entries).toHaveLength(4);
    expect(response.page).toBe(0);
    expect(response.limit).toBe(30);
    expect(response.total).toBe(150);
    expect(response.totalPages).toBe(5);
  });

  it('should deserialize entries using discriminator', () => {
    const response = FlowsheetV2PaginatedResponseFromJSON(paginatedJson);

    // Cast to FlowsheetV2Entry to use type guards
    const entries = response.entries as unknown as FlowsheetV2Entry[];

    expect(isV2TrackEntry(entries[0])).toBe(true);
    expect(isV2ShowStartEntry(entries[1])).toBe(true);
    expect(isV2BreakpointEntry(entries[2])).toBe(true);
    expect(isV2MessageEntry(entries[3])).toBe(true);
  });

  it('should preserve track metadata through discriminator deserialization', () => {
    const response = FlowsheetV2PaginatedResponseFromJSON(paginatedJson);
    const trackEntry = response.entries[0] as unknown as FlowsheetV2TrackEntry;

    expect(trackEntry.artist_name).toBe('Radiohead');
    expect(trackEntry.track_title).toBe('Paranoid Android');
    expect(trackEntry.rotation_bin).toBe(RotationBin.H);
    expect(trackEntry.add_time).toBeInstanceOf(Date);
  });

  it('should round-trip through JSON', () => {
    const response = FlowsheetV2PaginatedResponseFromJSON(paginatedJson);
    const json = FlowsheetV2PaginatedResponseToJSON(response);
    const roundTrip = FlowsheetV2PaginatedResponseFromJSON(json);

    expect(roundTrip.entries).toHaveLength(4);
    expect(roundTrip.page).toBe(0);
    expect(roundTrip.total).toBe(150);
  });

  it('should handle empty entries array', () => {
    const response = FlowsheetV2PaginatedResponseFromJSON({
      entries: [],
      page: 0,
      limit: 30,
      total: 0,
      totalPages: 0,
    });

    expect(response.entries).toHaveLength(0);
    expect(response.total).toBe(0);
  });
});

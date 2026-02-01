/**
 * Tests for TypeScript Extensions
 *
 * TDD: These tests define the expected behavior of type guards and utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  isFlowsheetSongEntry,
  isFlowsheetShowBlockEntry,
  isFlowsheetStartShowEntry,
  isFlowsheetEndShowEntry,
  isFlowsheetMessageEntry,
  isFlowsheetTalksetEntry,
  isFlowsheetBreakpointEntry,
  type PaginatedResponse,
  type FlowsheetEntry,
  type FlowsheetEntryResponse,
  type FlowsheetShowBlockEntry,
  type WeeklySchedule,
  type ScheduleShift,
} from '../src/dtos/index.js';

describe('Type Guards', () => {
  describe('isFlowsheetSongEntry', () => {
    it('should return true for song entries with track_title', () => {
      const songEntry: FlowsheetEntryResponse = {
        id: 1,
        play_order: 100,
        show_id: 1,
        request_flag: false,
        track_title: 'Test Song',
        artist_name: 'Test Artist',
        album_title: 'Test Album',
        record_label: 'Test Label',
      };

      expect(isFlowsheetSongEntry(songEntry)).toBe(true);
    });

    it('should return false for message entries', () => {
      const messageEntry: FlowsheetEntryResponse = {
        id: 2,
        play_order: 101,
        show_id: 1,
        request_flag: false,
        message: 'Talkset - station ID',
      };

      expect(isFlowsheetSongEntry(messageEntry)).toBe(false);
    });

    it('should return false when track_title is undefined', () => {
      const entry: FlowsheetEntryResponse = {
        id: 3,
        play_order: 102,
        show_id: 1,
        request_flag: false,
      };

      expect(isFlowsheetSongEntry(entry)).toBe(false);
    });
  });

  describe('isFlowsheetShowBlockEntry', () => {
    it('should return true for show block entries with dj_name', () => {
      const showBlockEntry = {
        id: 1,
        play_order: 100,
        show_id: 1,
        dj_name: 'DJ Test',
        isStart: true,
        day: 'Monday',
        time: '14:00',
      } as FlowsheetShowBlockEntry;

      expect(isFlowsheetShowBlockEntry(showBlockEntry)).toBe(true);
    });

    it('should return false for song entries', () => {
      const songEntry: FlowsheetEntryResponse = {
        id: 1,
        play_order: 100,
        show_id: 1,
        request_flag: false,
        track_title: 'Test Song',
      };

      expect(isFlowsheetShowBlockEntry(songEntry)).toBe(false);
    });
  });

  describe('isFlowsheetStartShowEntry', () => {
    it('should return true for show start entries', () => {
      const startEntry = {
        id: 1,
        play_order: 100,
        show_id: 1,
        dj_name: 'DJ Test',
        isStart: true,
        day: 'Monday',
        time: '14:00',
      } as FlowsheetShowBlockEntry;

      expect(isFlowsheetStartShowEntry(startEntry)).toBe(true);
    });

    it('should return false for show end entries', () => {
      const endEntry = {
        id: 1,
        play_order: 100,
        show_id: 1,
        dj_name: 'DJ Test',
        isStart: false,
        day: 'Monday',
        time: '16:00',
      } as FlowsheetShowBlockEntry;

      expect(isFlowsheetStartShowEntry(endEntry)).toBe(false);
    });
  });

  describe('isFlowsheetEndShowEntry', () => {
    it('should return true for show end entries', () => {
      const endEntry = {
        id: 1,
        play_order: 100,
        show_id: 1,
        dj_name: 'DJ Test',
        isStart: false,
        day: 'Monday',
        time: '16:00',
      } as FlowsheetShowBlockEntry;

      expect(isFlowsheetEndShowEntry(endEntry)).toBe(true);
    });

    it('should return false for show start entries', () => {
      const startEntry = {
        id: 1,
        play_order: 100,
        show_id: 1,
        dj_name: 'DJ Test',
        isStart: true,
        day: 'Monday',
        time: '14:00',
      } as FlowsheetShowBlockEntry;

      expect(isFlowsheetEndShowEntry(startEntry)).toBe(false);
    });
  });

  describe('isFlowsheetMessageEntry', () => {
    it('should return true for message entries', () => {
      const messageEntry: FlowsheetEntryResponse = {
        id: 1,
        play_order: 100,
        show_id: 1,
        request_flag: false,
        message: 'Station announcement',
      };

      expect(isFlowsheetMessageEntry(messageEntry)).toBe(true);
    });

    it('should return false for song entries', () => {
      const songEntry: FlowsheetEntryResponse = {
        id: 1,
        play_order: 100,
        show_id: 1,
        request_flag: false,
        track_title: 'Test Song',
      };

      expect(isFlowsheetMessageEntry(songEntry)).toBe(false);
    });

    it('should return false for show block entries (even with message)', () => {
      const showBlockEntry = {
        id: 1,
        play_order: 100,
        show_id: 1,
        dj_name: 'DJ Test',
        isStart: true,
        day: 'Monday',
        time: '14:00',
      } as FlowsheetShowBlockEntry;

      expect(isFlowsheetMessageEntry(showBlockEntry)).toBe(false);
    });
  });

  describe('isFlowsheetTalksetEntry', () => {
    it('should return true for talkset entries', () => {
      const talksetEntry: FlowsheetEntryResponse = {
        id: 1,
        play_order: 100,
        show_id: 1,
        request_flag: false,
        message: 'Talkset - station ID',
      };

      expect(isFlowsheetTalksetEntry(talksetEntry)).toBe(true);
    });

    it('should return false for non-talkset message entries', () => {
      const messageEntry: FlowsheetEntryResponse = {
        id: 1,
        play_order: 100,
        show_id: 1,
        request_flag: false,
        message: 'General announcement',
      };

      expect(isFlowsheetTalksetEntry(messageEntry)).toBe(false);
    });
  });

  describe('isFlowsheetBreakpointEntry', () => {
    it('should return true for breakpoint entries', () => {
      const breakpointEntry: FlowsheetEntryResponse = {
        id: 1,
        play_order: 100,
        show_id: 1,
        request_flag: false,
        message: 'Breakpoint - 3:00 PM',
      };

      expect(isFlowsheetBreakpointEntry(breakpointEntry)).toBe(true);
    });

    it('should return false for non-breakpoint message entries', () => {
      const messageEntry: FlowsheetEntryResponse = {
        id: 1,
        play_order: 100,
        show_id: 1,
        request_flag: false,
        message: 'Regular message',
      };

      expect(isFlowsheetBreakpointEntry(messageEntry)).toBe(false);
    });
  });
});

describe('Generic Types', () => {
  describe('PaginatedResponse<T>', () => {
    it('should work with any type parameter', () => {
      const response: PaginatedResponse<{ id: number; name: string }> = {
        data: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 100,
          hasMore: true,
        },
      };

      expect(response.data).toHaveLength(2);
      expect(response.pagination.page).toBe(1);
      expect(response.pagination.hasMore).toBe(true);
    });

    it('should allow optional pagination fields', () => {
      const response: PaginatedResponse<string> = {
        data: ['a', 'b', 'c'],
        pagination: {
          page: 1,
          limit: 10,
        },
      };

      expect(response.pagination.total).toBeUndefined();
      expect(response.pagination.hasMore).toBeUndefined();
    });
  });
});

describe('Union Types', () => {
  describe('FlowsheetEntry', () => {
    it('should accept song entries', () => {
      const entry: FlowsheetEntry = {
        id: 1,
        play_order: 100,
        show_id: 1,
        track_title: 'Test',
        artist_name: 'Artist',
        album_title: 'Album',
        record_label: 'Label',
        request_flag: false,
      };

      expect(isFlowsheetSongEntry(entry)).toBe(true);
    });

    it('should accept message entries', () => {
      const entry: FlowsheetEntry = {
        id: 1,
        play_order: 100,
        show_id: 1,
        message: 'Test message',
      };

      expect(isFlowsheetMessageEntry(entry)).toBe(true);
    });
  });
});

describe('Mapped Types', () => {
  describe('WeeklySchedule', () => {
    it('should have all days of the week', () => {
      const schedule: WeeklySchedule = {
        Sunday: [],
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
      };

      expect(Object.keys(schedule)).toHaveLength(7);
    });

    it('should accept schedule shifts for each day', () => {
      const shift: ScheduleShift = {
        id: 1,
        dj_id: 100,
        dj_name: 'Test DJ',
        day: 'Monday',
        start_time: '14:00',
        end_time: '16:00',
      };

      const schedule: WeeklySchedule = {
        Sunday: [],
        Monday: [shift],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
      };

      expect(schedule.Monday).toHaveLength(1);
      expect(schedule.Monday[0].dj_name).toBe('Test DJ');
    });
  });
});

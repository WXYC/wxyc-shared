import { describe, it, expect } from 'vitest';
import { callNumberCorpus, callNumberCases } from '../src/test-utils/call-number-cases.js';

const INPUT_FIELDS = [
  'genre',
  'format',
  'call_letters',
  'artist_number',
  'release_number',
  'volume_letters',
  'comp_letter',
  'artist_name',
] as const;

describe('call-number corpus shape', () => {
  it('exposes a meta block with description, version, schema, and decisions', () => {
    expect(callNumberCorpus.meta.description).toMatch(/call number/i);
    expect(callNumberCorpus.meta.version).toBe(1);
    for (const field of [...INPUT_FIELDS, 'id', 'why', 'full', 'artist_half', 'release_half']) {
      expect(callNumberCorpus.meta.schema[field], field).toBeTruthy();
    }
    expect(callNumberCorpus.meta.decisions.length).toBeGreaterThanOrEqual(2);
    for (const d of callNumberCorpus.meta.decisions) {
      expect(d.decision.length).toBeGreaterThan(0);
      expect(d.rationale.length).toBeGreaterThan(0);
    }
  });

  it('has unique, non-empty ids', () => {
    const ids = callNumberCases.map((c) => c.id);
    for (const id of ids) expect(id.trim()).not.toBe('');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(callNumberCases.map((c) => [c.id, c] as const))('%s carries every required field', (_id, c) => {
    expect(c.why.trim()).not.toBe('');
    for (const field of INPUT_FIELDS) expect(c, field).toHaveProperty(field);
    expect(typeof c.full).toBe('string');
    for (const half of [c.artist_half, c.release_half]) {
      expect(half === null || (typeof half === 'string' && half !== '')).toBe(true);
    }
  });

  it('expects a non-empty full string unless the row has nothing to compose', () => {
    for (const c of callNumberCases) {
      const hasInput = [c.genre, c.format, c.call_letters, c.artist_number, c.release_number].some(
        (v) => v !== null,
      );
      if (hasInput) expect(c.full, c.id).not.toBe('');
      else expect(c.full, c.id).toBe('');
    }
  });

  it('has no two rows with identical inputs', () => {
    const keys = callNumberCases.map((c) => JSON.stringify(INPUT_FIELDS.map((f) => c[f])));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('states target outputs only: no consumer divergence is recorded in the corpus', () => {
    expect(callNumberCorpus.meta.schema).not.toHaveProperty('pending');
    for (const c of callNumberCases) expect(c, c.id).not.toHaveProperty('pending');
  });

  it('has kebab-case ids', () => {
    for (const c of callNumberCases) expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('pins exactly the five partial rows (three plain, two carrying a volume letter)', () => {
    // Partial: a release number with no artist half to hang it on (no letters, or no artist number),
    // outside the V/A and legacy Z- compilation forms, which have their own rules.
    const partial = callNumberCases.filter((c) => {
      const letters = (c.call_letters ?? '').trim();
      const compilation = letters.toUpperCase() === 'V/A' || letters.startsWith('Z-');
      return !compilation && c.release_number !== null && (c.call_letters === null || c.artist_number === null);
    });
    expect(partial.map((c) => c.id).sort()).toEqual(
      [
        'genre-format-release-no-artist-half',
        'letters-without-artist-number',
        'release-only',
        'volume-letter-letters-without-artist-number',
        'volume-letter-release-only',
      ].sort(),
    );
  });

  describe('volume letters', () => {
    const volumeRows = callNumberCases.filter((c) => c.id.startsWith('volume-letter-'));
    type Row = (typeof volumeRows)[number];
    const blank = (c: Row) => (c.volume_letters ?? '').trim() === '';
    // Padded: surrounding whitespace around a non-blank letter (not the whitespace-only row).
    const isPadded = (c: Row) => !blank(c) && c.volume_letters !== c.volume_letters?.trim();
    // Lowercase: no surrounding whitespace, and not already upper-case (not the padded row).
    const isLowercase = (c: Row) =>
      c.volume_letters !== null &&
      c.volume_letters === c.volume_letters.trim() &&
      c.volume_letters !== c.volume_letters.toUpperCase();

    it('covers at least eight rows spanning every shape Backend pins', () => {
      expect(volumeRows.length).toBeGreaterThanOrEqual(8);
      for (const c of volumeRows) expect(c.volume_letters, c.id).not.toBeNull();
      const has = (pred: (c: Row) => boolean) => volumeRows.some(pred);
      expect(has((c) => c.genre === 'Rock' && c.call_letters === 'ST')).toBe(true);
      expect(has((c) => c.genre === 'Hiphop' && c.call_letters === 'V/A' && c.release_number !== null)).toBe(true);
      expect(has((c) => c.genre === 'Rock' && c.call_letters === 'Z-A')).toBe(true);
      expect(has((c) => c.genre === 'Soundtracks')).toBe(true);
      expect(has(isLowercase)).toBe(true);
      expect(has((c) => c.volume_letters !== null && c.volume_letters !== '' && blank(c))).toBe(true);
      expect(has(isPadded)).toBe(true);
      expect(has((c) => c.release_number === null && c.call_letters === 'V/A')).toBe(true);
      expect(has((c) => c.release_number === null && c.call_letters === 'Q')).toBe(true);
    });

    it('renders -<LETTER> only when the letter is non-blank and the row has a release number', () => {
      for (const c of volumeRows) {
        const letter = c.volume_letters?.trim().toUpperCase() ?? '';
        const suffixed = c.release_number !== null && letter !== '';
        const expectedHalf =
          c.release_number === null ? null : suffixed ? `${c.release_number}-${letter}` : String(c.release_number);
        expect(c.release_half, c.id).toBe(expectedHalf);
        if (suffixed) expect(c.full.endsWith(`-${letter}`), c.id).toBe(true);
        else expect(c.full, c.id).not.toMatch(/-[A-Z]$/);
      }
    });

    it('uses comp_letter or the legacy Z- code, never the artist name, for the Rock compilation bin', () => {
      const rock = volumeRows.find((c) => c.genre === 'Rock' && c.artist_number === 0)!;
      expect(rock.comp_letter !== null || rock.call_letters?.startsWith('Z-')).toBe(true);
    });

    it('records the padded-letter decision', () => {
      expect(callNumberCorpus.meta.decisions.some((d) => /trimmed and upper-cased/.test(d.decision))).toBe(true);
    });
  });
});

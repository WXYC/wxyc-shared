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

  it('pins exactly the three forced partial rows', () => {
    // Partial: a release number with no artist half to hang it on (no letters, or no artist number),
    // outside the V/A and legacy Z- compilation forms, which have their own rules.
    const partial = callNumberCases.filter((c) => {
      const letters = (c.call_letters ?? '').trim();
      const compilation = letters.toUpperCase() === 'V/A' || letters.startsWith('Z-');
      return !compilation && c.release_number !== null && (c.call_letters === null || c.artist_number === null);
    });
    expect(partial.map((c) => c.id).sort()).toEqual(
      ['genre-format-release-no-artist-half', 'letters-without-artist-number', 'release-only'].sort(),
    );
  });
});

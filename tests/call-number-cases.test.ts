import { describe, it, expect } from 'vitest';
import { callNumberCorpus, callNumberCases, CALL_NUMBER_CONSUMERS } from '../src/test-utils/call-number-cases.js';

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
    for (const field of [...INPUT_FIELDS, 'id', 'why', 'full', 'artist_half', 'release_half', 'pending']) {
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

  it('keys pending markers by known consumer with an owner/repo#N ticket ref, never this corpus\'s own issue', () => {
    for (const c of callNumberCases) {
      for (const [consumer, ref] of Object.entries(c.pending ?? {})) {
        expect(CALL_NUMBER_CONSUMERS, c.id).toContain(consumer);
        expect(ref, c.id).toMatch(/^[\w.-]+\/[\w.-]+#\d+$/);
        expect(ref, c.id).not.toBe('WXYC/wxyc-shared#585');
      }
    }
  });

  it('has kebab-case ids', () => {
    for (const c of callNumberCases) expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('records the forced partial-row divergence on Backend for every partial row', () => {
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
    for (const c of partial) expect(c.pending?.backend, c.id).toBe('WXYC/Backend-Service#2827');
  });
});

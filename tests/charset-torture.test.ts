import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  charsetTortureCorpus,
  charsetTortureEntries,
  CHARSET_TORTURE_CATEGORIES,
  type CharsetTortureCategory,
} from '../src/test-utils/charset-torture.js';

const corpusJsonPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/test-utils/charset-torture.json',
);

describe('charset-torture corpus shape', () => {
  it('exposes a meta block with description, version, schema, and sources', () => {
    expect(charsetTortureCorpus.meta.description).toMatch(/torture/i);
    expect(charsetTortureCorpus.meta.version).toBe(1);
    expect(charsetTortureCorpus.meta.sources.length).toBeGreaterThanOrEqual(1);
    for (const field of ['input', 'expected_storage', 'expected_match_form', 'expected_ascii_form', 'notes']) {
      expect(charsetTortureCorpus.meta.schema[field]).toBeTruthy();
    }
  });

  it('covers every required category with at least one entry', () => {
    for (const category of CHARSET_TORTURE_CATEGORIES) {
      const entries = charsetTortureCorpus.categories[category];
      expect(entries, `category "${category}" is missing`).toBeDefined();
      expect(entries.length, `category "${category}" has no entries`).toBeGreaterThanOrEqual(1);
    }
  });

  it('total entry count is in the documented 50–80 range', () => {
    expect(charsetTortureEntries.length).toBeGreaterThanOrEqual(50);
    expect(charsetTortureEntries.length).toBeLessThanOrEqual(80);
  });

  it('every entry has the expected fields with correct types', () => {
    for (const entry of charsetTortureEntries) {
      const where = `${entry.category}: ${JSON.stringify(entry.input)}`;
      expect(typeof entry.input, where).toBe('string');
      expect(entry.input.length, where).toBeGreaterThan(0);
      expect(typeof entry.expected_storage, where).toBe('string');
      expect(
        entry.expected_match_form === null || typeof entry.expected_match_form === 'string',
        where,
      ).toBe(true);
      expect(
        entry.expected_ascii_form === null || typeof entry.expected_ascii_form === 'string',
        where,
      ).toBe(true);
      expect(typeof entry.notes, where).toBe('string');
      expect(entry.notes.length, where).toBeGreaterThan(10);
    }
  });

  it('no duplicate inputs within a category', () => {
    for (const category of CHARSET_TORTURE_CATEGORIES) {
      const inputs = charsetTortureCorpus.categories[category].map((e) => e.input);
      expect(new Set(inputs).size, `category "${category}" has duplicate inputs`).toBe(inputs.length);
    }
  });
});

describe('charset-torture corpus byte stability', () => {
  // Pinned so any edit to the JSON forces a coordinated downstream consumer
  // bump; see README "Charset Torture Corpus" for the bump procedure.
  const PINNED_SHA256 = '75a3395bb10894480dba95bf5b7f379f5056645098d6a1bf9e94416709e5214a';

  it('SHA-256 of the JSON file matches the pinned hash', () => {
    const actual = createHash('sha256').update(readFileSync(corpusJsonPath)).digest('hex');
    expect(actual).toBe(PINNED_SHA256);
  });
});

describe('charset-torture corpus content invariants', () => {
  it('Greek sigma fold: ς, σ, Σ all collapse to the same match-form bucket', () => {
    const greek = charsetTortureCorpus.categories.greek;
    const sigmas = greek.filter((e) => ['ς', 'σ', 'Σ'].includes(e.input));
    expect(sigmas.length).toBe(3);
    const buckets = new Set(sigmas.map((e) => e.expected_match_form));
    expect(buckets.size).toBe(1);
    expect(buckets.has('σ')).toBe(true);
  });

  it('Greek positional sigma in a word: Στελλάς and Στελλάσ share a match-form bucket', () => {
    const greek = charsetTortureCorpus.categories.greek;
    const finalForm = greek.find((e) => e.input === 'Στελλάς');
    const medialForm = greek.find((e) => e.input === 'Στελλάσ');
    expect(finalForm).toBeDefined();
    expect(medialForm).toBeDefined();
    expect(finalForm!.expected_match_form).toBe(medialForm!.expected_match_form);
  });

  it('NFC and NFD forms of café/ñ collide in match-form', () => {
    const norm = charsetTortureCorpus.categories.normalization;
    const cafeNfc = norm.find((e) => e.input === 'café');
    const cafeNfd = norm.find((e) => e.input === 'cafe\u0301');
    expect(cafeNfc?.expected_match_form).toBe('cafe');
    expect(cafeNfd?.expected_match_form).toBe('cafe');
    expect(cafeNfc!.input).not.toBe(cafeNfd!.input);
  });

  it('mojibake_known entries have expected_storage that differs from input', () => {
    for (const entry of charsetTortureCorpus.categories.mojibake_known) {
      expect(
        entry.expected_storage,
        `mojibake entry ${JSON.stringify(entry.input)} should have a fixed form differing from the broken input`,
      ).not.toBe(entry.input);
    }
  });

  it('non-mojibake categories: expected_storage equals input (storage layer is passive)', () => {
    const nonMojibake: CharsetTortureCategory[] = CHARSET_TORTURE_CATEGORIES.filter(
      (c) => c !== 'mojibake_known',
    );
    for (const category of nonMojibake) {
      for (const entry of charsetTortureCorpus.categories[category]) {
        expect(
          entry.expected_storage,
          `${category}: ${JSON.stringify(entry.input)} input/storage divergence`,
        ).toBe(entry.input);
      }
    }
  });

  it('emoji entries actually use 4-byte UTF-8 (supplementary plane)', () => {
    for (const entry of charsetTortureCorpus.categories.emoji) {
      const hasSupplementary = [...entry.input].some((c) => c.codePointAt(0)! > 0xffff);
      expect(hasSupplementary, `${JSON.stringify(entry.input)} has no supplementary-plane codepoint`).toBe(true);
    }
  });

  it('bidi_marks entries actually contain a Cf bidi-marker codepoint', () => {
    const bidiCodepoints = new Set([0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e]);
    for (const entry of charsetTortureCorpus.categories.bidi_marks) {
      const found = [...entry.input].some((c) => bidiCodepoints.has(c.codePointAt(0)!));
      expect(found, `${JSON.stringify(entry.input)} has no LRM/RLM/LRO/RLO/PDF codepoint`).toBe(true);
    }
  });

  it('zwj entries actually contain a U+200D ZERO WIDTH JOINER or regional indicator', () => {
    const ZWJ = 0x200d;
    const REGIONAL_LO = 0x1f1e6;
    const REGIONAL_HI = 0x1f1ff;
    for (const entry of charsetTortureCorpus.categories.zwj) {
      const found = [...entry.input].some((c) => {
        const cp = c.codePointAt(0)!;
        return cp === ZWJ || (cp >= REGIONAL_LO && cp <= REGIONAL_HI);
      });
      expect(found, `${JSON.stringify(entry.input)} has neither ZWJ nor regional indicator`).toBe(true);
    }
  });

  it('flat charsetTortureEntries iterates every category and tags each entry', () => {
    let total = 0;
    for (const category of CHARSET_TORTURE_CATEGORIES) {
      total += charsetTortureCorpus.categories[category].length;
    }
    expect(charsetTortureEntries.length).toBe(total);
    for (const entry of charsetTortureEntries) {
      expect(CHARSET_TORTURE_CATEGORIES).toContain(entry.category);
    }
  });

});

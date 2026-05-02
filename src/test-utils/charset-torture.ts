/**
 * Charset Torture Corpus
 *
 * Cross-repo UTF-8 round-trip fixture. Every consumer's CI loads this corpus
 * and writes each entry through its primary storage path, reads back, and
 * asserts byte equality. If a byte is dropped, mis-decoded, or normalized
 * incorrectly anywhere in any pipeline, the test fails.
 *
 * Canonical JSON: src/test-utils/charset-torture.json. Non-TS consumers
 * extract that file from the published @wxyc/shared tarball and pin its
 * SHA-256; see the README "Charset Torture Corpus" section for recipes.
 */

import data from './charset-torture.json' with { type: 'json' };

export interface CharsetTortureEntry {
  /** Raw UTF-8 string the storage layer must round-trip losslessly. */
  input: string;
  /** Canonical (mojibake-fixed) form. Equals input for non-mojibake categories. */
  expected_storage: string;
  /**
   * Output of `to_match_form(expected_storage)`. NFKD + strip combining marks
   * + lowercase + Greek sigma fold + trim. `null` when WX-2 has not formalized
   * the rule for this script.
   */
  expected_match_form: string | null;
  /**
   * Output of `to_ascii_form(expected_storage)`. Lowercase ASCII transliteration.
   * `null` for scripts without a defined transliteration in v1.
   */
  expected_ascii_form: string | null;
  /** Why this entry exists; which incident or category it pins. */
  notes: string;
}

export type CharsetTortureCategory =
  | 'greek'
  | 'cyrillic'
  | 'cjk'
  | 'arabic'
  | 'hebrew'
  | 'emoji'
  | 'latin_extended'
  | 'bidi_marks'
  | 'zwj'
  | 'normalization'
  | 'mojibake_known'
  | 'quoting';

export interface CharsetTortureCorpus {
  meta: {
    description: string;
    version: number;
    schema: Record<string, string>;
    sources: string[];
  };
  categories: Record<CharsetTortureCategory, CharsetTortureEntry[]>;
}

export const charsetTortureCorpus = data as CharsetTortureCorpus;

/**
 * Required category coverage. Adding a category requires a corpus version
 * bump and a coordinated update to every consumer's pinned SHA-256.
 */
export const CHARSET_TORTURE_CATEGORIES: readonly CharsetTortureCategory[] = [
  'greek',
  'cyrillic',
  'cjk',
  'arabic',
  'hebrew',
  'emoji',
  'latin_extended',
  'bidi_marks',
  'zwj',
  'normalization',
  'mojibake_known',
  'quoting',
];

/** All entries flattened across categories — convenient for parametrized tests. */
export const charsetTortureEntries: ReadonlyArray<
  CharsetTortureEntry & { category: CharsetTortureCategory }
> = CHARSET_TORTURE_CATEGORIES.flatMap((category) =>
  charsetTortureCorpus.categories[category].map((entry) => ({ ...entry, category })),
);

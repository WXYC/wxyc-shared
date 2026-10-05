/**
 * Call-Number Parity Corpus
 *
 * Cross-repo fixture for the three shelf call-number composers: LML
 * `LibraryItem.call_number`, Backend `computeCallNumber`, and dj-site's
 * `libraryCode.ts` formatters. Each consumer drives its tests from these rows.
 *
 * Canonical JSON: src/test-utils/call-number-cases.json. Non-TS consumers
 * extract that file from the published @wxyc/shared tarball and pin its
 * SHA-256, as with the charset torture corpus.
 */

import data from './call-number-cases.json' with { type: 'json' };

export const CALL_NUMBER_CONSUMERS = ['lml', 'backend', 'djsite'] as const;

export type CallNumberConsumer = (typeof CALL_NUMBER_CONSUMERS)[number];

export interface CallNumberCase {
  id: string;
  /** One line: what the row pins. */
  why: string;
  genre: string | null;
  format: string | null;
  call_letters: string | null;
  artist_number: number | null;
  release_number: number | null;
  volume_letters: string | null;
  comp_letter: string | null;
  artist_name: string | null;
  /** The LML/Backend string. Empty only when no input composes. */
  full: string;
  /** dj-site `formatArtistCodeWithPunctuation`; null when it has no artist half to render. */
  artist_half: string | null;
  /** dj-site `formatReleaseCode`; null when the row has no release number. */
  release_half: string | null;
  /** Ticket that closes a consumer's known divergence from this row. */
  pending?: Partial<Record<CallNumberConsumer, string>>;
}

export interface CallNumberCorpus {
  meta: {
    description: string;
    version: number;
    schema: Record<string, string>;
    decisions: Array<{ decision: string; rationale: string }>;
  };
  cases: CallNumberCase[];
}

export const callNumberCorpus = data as CallNumberCorpus;

export const callNumberCases: ReadonlyArray<CallNumberCase> = callNumberCorpus.cases;

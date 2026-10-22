/**
 * Tag Lint
 *
 * The one rule set for audio tags that arrive with a review upload. The DJ site
 * runs it before upload and Backend-Service runs it at its publish gate, so the
 * two never disagree about which tags are bad. Pure and deterministic: no I/O,
 * no clock, no locale-dependent calls. Safe in the browser and in Node.
 */

/**
 * Every tag issue code, in the order a track's issues are listed.
 * This module is the one place the codes are defined.
 */
export const TAG_ISSUE_CODES = [
  "artist_digits_only",
  "title_leading_track_number",
  "missing_title",
  "missing_artist",
  "missing_album",
  "album_disagrees",
  "album_artist_disagrees",
  "tags_disagree_with_record",
  "track_number_missing",
  "track_number_duplicate",
  "duration_short",
  "duration_long",
  "unreadable",
] as const;

/** A tag issue code: one of {@link TAG_ISSUE_CODES}. */
export type TagLintIssueCode = (typeof TAG_ISSUE_CODES)[number];

/** `error` stops publishing; `warning` informs. */
export type TagLintSeverity = "error" | "warning";

/** The severity of each code. */
export const TAG_LINT_SEVERITY: Record<TagLintIssueCode, TagLintSeverity> = {
  artist_digits_only: "error",
  title_leading_track_number: "error",
  missing_title: "error",
  missing_artist: "error",
  missing_album: "error",
  album_disagrees: "error",
  album_artist_disagrees: "error",
  tags_disagree_with_record: "error",
  track_number_missing: "warning",
  track_number_duplicate: "warning",
  duration_short: "warning",
  duration_long: "warning",
  unreadable: "error",
};

/** The tags of one uploaded track, as the ingest worker read them. */
export type TagLintTrack = {
  track_id: number;
  disc_number: number | null;
  track_number: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  duration_ms: number | null;
  /** The ingest worker could not read the file. */
  unreadable: boolean;
};

/** The catalog record the tracks are uploaded against. */
export type TagLintRecord = { artist: string; album: string; compilation: boolean };

/**
 * One problem with one track. `field` names the `TrackTags` field at fault, or is `null` when
 * no tag is at fault: the whole file (`unreadable`) or the audio length (`duration_short`,
 * `duration_long`), which no tag holds. Named `TagLintIssue` because `TagIssue` is the schema
 * `api.yaml` declares for the same shape, and the package index re-exports both.
 */
export type TagLintIssue = { code: TagLintIssueCode; severity: TagLintSeverity; field: string | null };

const SHORT_TRACK_MS = 15_000;
const LONG_TRACK_MS = 30 * 60 * 1000;

// A track number the title carries: one to three digits and a separator, then text.
const LEADING_TRACK_NUMBER = /^\s*\d{1,3}[\s._-]+(?=[^\s._-])/;

// A combining mark after a Latin or Greek base is decoration. After a Cyrillic, Hebrew or
// Arabic base it is part of the letter (Ё, Й, niqqud), so it stays.
const DECORATION = /([\u{0000}-\u{024F}\u{0370}-\u{03FF}\u{1E00}-\u{1FFF}\u{2C60}-\u{2C7F}\u{A720}-\u{A7FF}\u{AB30}-\u{AB6F}])\p{M}+/gu;

/**
 * Fold a tag value to the org's match form. This is `to_match_form` in `wxyc-etl` applied to
 * storage-form input, without its mojibake-repair step, so text that was already garbled
 * ("NilÃ¼fer Yanya") does not fold equal to its repaired form. The steps are NFKC, lowercase,
 * combining marks stripped from Latin and Greek letters, the fold registry (final sigma, and
 * the ae and oe ligatures), format characters (Cf) stripped except U+200D, runs of spaces
 * collapsed, and spaces trimmed.
 *
 * @example
 * foldForTagCompare("  Nilüfer   Yanya ") // "nilufer yanya"
 */
export function foldForTagCompare(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(DECORATION, "$1")
    .normalize("NFC")
    .replace(/ς/g, "σ")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/(?!\u{200D})\p{Cf}/gu, "")
    .replace(/ {2,}/g, " ")
    .replace(/^ | $/g, "");
}

/**
 * Remove a track number from the start of a title ("Remove track numbers from
 * titles"). A title that has no track number, or nothing after it, is returned unchanged.
 *
 * @example
 * stripLeadingTrackNumber("01 la paradoja") // "la paradoja"
 * stripLeadingTrackNumber("1999") // "1999"
 */
export function stripLeadingTrackNumber(title: string): string {
  return title.replace(LEADING_TRACK_NUMBER, "");
}

/**
 * Lint the tracks of one upload against the record they belong to.
 *
 * @param record - The catalog record the tracks are uploaded against.
 * @param tracks - The tracks of the upload.
 * @returns The issues by `track_id`, each track's issues in {@link TAG_ISSUE_CODES} order.
 * Tracks without issues are absent, so an empty map means a clean upload. A track the worker
 * could not read gets only `unreadable` and takes no part in the cross-track comparisons.
 *
 * @example
 * const issues = lintTracks({ artist: "Juana Molina", album: "DOGA", compilation: false }, tracks);
 * const blocked = [...issues.values()].some((list) => list.some((issue) => issue.severity === "error"));
 */
export function lintTracks(record: TagLintRecord, tracks: TagLintTrack[]): Map<number, TagLintIssue[]> {
  const found = new Map<number, TagLintIssue[]>();
  const flag = (track: TagLintTrack, code: TagLintIssueCode, field: string | null): void => {
    const issue = { code, severity: TAG_LINT_SEVERITY[code], field };
    const issues = found.get(track.track_id);
    if (issues) {
      issues.push(issue);
    } else {
      found.set(track.track_id, [issue]);
    }
  };
  // A value's folded form with any edge whitespace trimmed; "" when it is missing or blank.
  // The record's values and the tracks' tags both go through it, so they compare alike.
  const fold = (value: string | null): string => (value === null ? "" : foldForTagCompare(value).trim());

  const readable = tracks.filter((track) => !track.unreadable);
  tracks.filter((track) => track.unreadable).forEach((track) => flag(track, "unreadable", null));

  const recordArtist = fold(record.artist);
  const recordAlbum = fold(record.album);
  const numbered = new Map<string, TagLintTrack[]>();
  for (const track of readable) {
    if (track.artist !== null && /^\p{Nd}+$/u.test(track.artist.trim())) {
      flag(track, "artist_digits_only", "artist");
    }
    if (track.title !== null && LEADING_TRACK_NUMBER.test(track.title)) {
      flag(track, "title_leading_track_number", "title");
    }
    for (const field of ["title", "artist", "album"] as const) {
      if (fold(track[field]) === "") {
        flag(track, `missing_${field}`, field);
      }
    }
    if (!record.compilation && fold(track.artist) !== "" && fold(track.artist) !== recordArtist) {
      flag(track, "tags_disagree_with_record", "artist");
    }
    if (fold(track.album) !== "" && fold(track.album) !== recordAlbum) {
      flag(track, "tags_disagree_with_record", "album");
    }
    if (track.track_number === null) {
      flag(track, "track_number_missing", "track_number");
    } else {
      const key = `${track.disc_number ?? 1}:${track.track_number}`;
      numbered.set(key, [...(numbered.get(key) ?? []), track]);
    }
    if (track.duration_ms !== null && track.duration_ms < SHORT_TRACK_MS) {
      flag(track, "duration_short", null);
    }
    if (track.duration_ms !== null && track.duration_ms > LONG_TRACK_MS) {
      flag(track, "duration_long", null);
    }
  }

  for (const group of numbered.values()) {
    if (group.length > 1) {
      group.forEach((track) => flag(track, "track_number_duplicate", "track_number"));
    }
  }
  for (const [field, code] of [
    ["album", "album_disagrees"],
    ["album_artist", "album_artist_disagrees"],
  ] as const) {
    const tagged = readable.filter((track) => fold(track[field]) !== "");
    if (new Set(tagged.map((track) => fold(track[field]))).size > 1) {
      tagged.forEach((track) => flag(track, code, field));
    }
  }

  for (const issues of found.values()) {
    issues.sort((a, b) => TAG_ISSUE_CODES.indexOf(a.code) - TAG_ISSUE_CODES.indexOf(b.code));
  }
  return found;
}

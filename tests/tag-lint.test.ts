import { describe, it, expect } from "vitest";
import {
  TAG_ISSUE_CODES,
  TAG_LINT_SEVERITY,
  foldForTagCompare,
  lintTracks,
  stripLeadingTrackNumber,
  type TagIssueCode,
  type TagLintRecord,
  type TagLintTrack,
} from "../src/validation/index.js";
import { charsetTortureEntries } from "../src/test-utils/charset-torture.js";
import { wxycCanonicalArtistNames } from "../src/test-utils/wxyc-example-data.js";

/** One issue as `[code, field]`, the shape the tables below assert against. */
type Expected = Array<[TagIssueCode, string | null]>;

const record: TagLintRecord = { artist: "Juana Molina", album: "DOGA", compilation: false };
const compilation: TagLintRecord = { artist: "Various Artists", album: "DOGA", compilation: true };

/** A clean track from the WXYC example flowsheet; every rule stays quiet on it. */
const track = (overrides: Partial<TagLintTrack> = {}): TagLintTrack => ({
  track_id: 1,
  disc_number: 1,
  track_number: 1,
  title: "la paradoja",
  artist: "Juana Molina",
  album: "DOGA",
  album_artist: "Juana Molina",
  duration_ms: 214_000,
  unreadable: false,
  ...overrides,
});

/** Lint results as plain `{ track_id: [[code, field], ...] }` for readable assertions. */
const lint = (rec: TagLintRecord, tracks: TagLintTrack[]): Record<number, Expected> =>
  Object.fromEntries(
    [...lintTracks(rec, tracks)].map(([id, issues]) => [id, issues.map((i) => [i.code, i.field])]),
  );

describe("foldForTagCompare", () => {
  describe("charset torture corpus", () => {
    const cases = charsetTortureEntries
      .filter((entry) => entry.expected_match_form !== null)
      .map((entry) => [
        `${entry.category}: ${JSON.stringify(entry.expected_storage)}`,
        entry.expected_storage,
        entry.expected_match_form as string,
      ]);

    it("has entries to check", () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    it.each(cases)("%s", (_label, storage, matchForm) => {
      expect(foldForTagCompare(storage as string)).toBe(matchForm);
    });
  });

  it.each([
    ["Nilüfer Yanya", "Nilufer Yanya"],
    ["Hermanos Gutiérrez", "Hermanos Gutierrez"],
    ["Csillagrablók", "Csillagrablok"],
  ])("folds the canonical artist %s equal to %s", (name, unaccented) => {
    expect(wxycCanonicalArtistNames).toContain(name);
    expect(foldForTagCompare(name)).toBe(foldForTagCompare(unaccented));
  });

  it.each([
    ["case", "Juana Molina", "JUANA MOLINA"],
    ["space runs and edges", "  Jessica   Pratt  ", "jessica pratt"],
    ["NFC versus NFD", "Sigur Rós", "Sigur Rós"],
    ["compatibility forms", "Ｊｕａｎａ", "Juana"],
    ["ligatures", "Cœur de Pirate", "Coeur de Pirate"],
    ["final sigma", "Στελλάς", "Στελλάσ"],
    ["format characters", "Duke\u200B Ellington", "Duke Ellington"],
  ])("folds %s together", (_label, a, b) => {
    expect(foldForTagCompare(a)).toBe(foldForTagCompare(b));
  });

  it("keeps U+200D so emoji sequences stay whole", () => {
    expect(foldForTagCompare("\u{1F468}\u200D\u{1F3A4}")).toContain("\u200D");
  });

  // `to_match_form` in wxyc-etl repairs mojibake first; this fold takes storage-form input
  // and does not, so a UTF-8 "ü" misread as Latin-1 ("Ã¼") stays a different string.
  it("does not repair mojibake", () => {
    const mojibake = "NilÃ¼fer Yanya";
    expect(foldForTagCompare(mojibake)).toBe("nila1⁄4fer yanya");
    expect(foldForTagCompare(mojibake)).not.toBe(foldForTagCompare("Nilüfer Yanya"));
  });

  it.each([
    ["different names", "Juana Molina", "Jessica Pratt"],
    ["a Cyrillic letter and its base", "Ёж", "Еж"],
    ["a sharp s and ss", "Straße", "Strasse"],
    ["tabs and spaces", "tab\there", "tab here"],
  ])("keeps %s apart", (_label, a, b) => {
    expect(foldForTagCompare(a)).not.toBe(foldForTagCompare(b));
  });
});

describe("stripLeadingTrackNumber", () => {
  it.each([
    ["01 la paradoja", "la paradoja"],
    ["3. Back, Baby", "Back, Baby"],
    ["12-Call Your Name", "Call Your Name"],
    ["007_In a Sentimental Mood", "In a Sentimental Mood"],
    ["  04 -  Cut Your Hair", "Cut Your Hair"],
    // The rule's `^\d{1,3}[\s._-]+` reads a digit and a hyphen as a track number.
    ["7-Up", "Up"],
    // No separator, too many digits, or nothing after the separator: left alone.
    ["1999", "1999"],
    ["1999 Revisited", "1999 Revisited"],
    ["7-", "7-"],
    ["7up", "7up"],
    ["Back, Baby", "Back, Baby"],
    ["la paradoja 01", "la paradoja 01"],
    ["", ""],
  ])("%j -> %j", (title, expected) => {
    expect(stripLeadingTrackNumber(title)).toBe(expected);
  });
});

describe("TAG_ISSUE_CODES and TAG_LINT_SEVERITY", () => {
  it("cover the same codes", () => {
    expect(Object.keys(TAG_LINT_SEVERITY).sort()).toEqual([...TAG_ISSUE_CODES].sort());
  });

  it("list each code once", () => {
    expect(new Set(TAG_ISSUE_CODES).size).toBe(TAG_ISSUE_CODES.length);
  });

  it.each<[TagIssueCode, "error" | "warning"]>([
    ["artist_digits_only", "error"],
    ["title_leading_track_number", "error"],
    ["missing_title", "error"],
    ["missing_artist", "error"],
    ["missing_album", "error"],
    ["album_disagrees", "error"],
    ["album_artist_disagrees", "error"],
    ["tags_disagree_with_record", "error"],
    ["track_number_missing", "warning"],
    ["track_number_duplicate", "warning"],
    ["duration_short", "warning"],
    ["duration_long", "warning"],
    ["unreadable", "error"],
  ])("%s is %s", (code, severity) => {
    expect(TAG_LINT_SEVERITY[code]).toBe(severity);
  });
});

describe("lintTracks", () => {
  it("returns an empty map for a clean batch", () => {
    const tracks = [track(), track({ track_id: 2, track_number: 2, title: "Cosita Rica" })];
    expect(lintTracks(record, tracks).size).toBe(0);
  });

  it("returns an empty map for no tracks", () => {
    expect(lintTracks(record, []).size).toBe(0);
  });

  it("attaches the severity from TAG_LINT_SEVERITY", () => {
    const issues = lintTracks(record, [track({ track_number: null, artist: "08" })]).get(1) ?? [];
    expect(issues.map((i) => [i.code, i.severity])).toContainEqual(["artist_digits_only", "error"]);
    expect(issues.map((i) => [i.code, i.severity])).toContainEqual(["track_number_missing", "warning"]);
  });

  it("lists a track's issues in TAG_ISSUE_CODES order", () => {
    const issues = lintTracks(record, [
      track({ title: "01 x", artist: "08", album: null, duration_ms: 1_000, track_number: null }),
    ]).get(1);
    const positions = (issues ?? []).map((i) => TAG_ISSUE_CODES.indexOf(i.code));
    expect(positions.length).toBeGreaterThan(3);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  describe("tag content on one track", () => {
    // A compilation record exempts the artist from the record check, so these rows isolate the content rules.
    it.each<[string, Partial<TagLintTrack>, Expected]>([
      ["artist digits only", { artist: "08" }, [["artist_digits_only", "artist"]]],
      ["artist digits only after trimming", { artist: " 08 " }, [["artist_digits_only", "artist"]]],
      ["artist with digits and letters", { artist: "808 State" }, []],
      ["artist that is a name", { artist: "Jessica Pratt" }, []],
      ["title with a leading track number", { title: "01 la paradoja" }, [["title_leading_track_number", "title"]]],
      ["title with a dotted track number", { title: "3. Back, Baby" }, [["title_leading_track_number", "title"]]],
      ["title that is a bare year", { title: "1999" }, []],
      ["title with a trailing number", { title: "la paradoja 01" }, []],
      ["null title", { title: null }, [["missing_title", "title"]]],
      ["blank title", { title: "   " }, [["missing_title", "title"]]],
      ["one-letter title", { title: "a" }, []],
      ["null artist", { artist: null }, [["missing_artist", "artist"]]],
      ["empty artist", { artist: "" }, [["missing_artist", "artist"]]],
      ["null album", { album: null }, [["missing_album", "album"]]],
      ["blank album", { album: "\t " }, [["missing_album", "album"]]],
    ])("%s", (_label, overrides, expected) => {
      const result = lint(compilation, [track(overrides)]);
      expect(result[1] ?? []).toEqual(expected);
    });
  });

  describe("tags that disagree between tracks", () => {
    const disagreeing = (field: "album" | "album_artist") => [
      track({ track_id: 1, track_number: 1 }),
      track({ track_id: 2, track_number: 2, [field]: "Doga (Deluxe)" }),
      track({ track_id: 3, track_number: 3 }),
    ];

    it.each<[string, TagLintTrack[], Record<number, Expected>]>([
      [
        "album differs on one track",
        disagreeing("album"),
        {
          1: [["album_disagrees", "album"]],
          // The outlier also differs from the record's album, so it carries both.
          2: [
            ["album_disagrees", "album"],
            ["tags_disagree_with_record", "album"],
          ],
          3: [["album_disagrees", "album"]],
        },
      ],
      [
        "album differs only by case and spacing",
        [track({ track_id: 1 }), track({ track_id: 2, track_number: 2, album: " doga " })],
        {},
      ],
      [
        "album is missing on one track",
        [track({ track_id: 1 }), track({ track_id: 2, track_number: 2, album: null })],
        { 2: [["missing_album", "album"]] },
      ],
      [
        "album artist differs on one track",
        disagreeing("album_artist"),
        {
          1: [["album_artist_disagrees", "album_artist"]],
          2: [["album_artist_disagrees", "album_artist"]],
          3: [["album_artist_disagrees", "album_artist"]],
        },
      ],
      [
        "album artist differs only by diacritics",
        [
          track({ track_id: 1, album_artist: "Nilüfer Yanya" }),
          track({ track_id: 2, track_number: 2, album_artist: "Nilufer Yanya" }),
        ],
        {},
      ],
      [
        "album artist is null on one track",
        [track({ track_id: 1 }), track({ track_id: 2, track_number: 2, album_artist: null })],
        {},
      ],
    ])("%s", (_label, tracks, expected) => {
      expect(lint(compilation, tracks)).toEqual(expected);
    });
  });

  describe("tags that disagree with the record", () => {
    it.each<[string, TagLintRecord, Partial<TagLintTrack>, Expected]>([
      ["artist differs", record, { artist: "Jessica Pratt" }, [["tags_disagree_with_record", "artist"]]],
      ["album differs", record, { album: "On Your Own Love Again" }, [["tags_disagree_with_record", "album"]]],
      [
        "artist and album differ",
        record,
        { artist: "Jessica Pratt", album: "On Your Own Love Again" },
        [
          ["tags_disagree_with_record", "artist"],
          ["tags_disagree_with_record", "album"],
        ],
      ],
      ["artist differs only by case and spacing", record, { artist: " juana  MOLINA" }, []],
      ["artist differs only by diacritics", { ...record, artist: "Nilüfer Yanya" }, { artist: "Nilufer Yanya" }, []],
      // The record's values are folded and trimmed the way the tracks' are, so edge whitespace
      // beyond spaces on the record's side does not count as a difference.
      ["record artist has a trailing tab", { ...record, artist: "Juana Molina\t" }, {}, []],
      ["record album has a leading newline", { ...record, album: "\nDOGA" }, {}, []],
      ["artist is missing", record, { artist: null }, [["missing_artist", "artist"]]],
      ["compilation track by another artist", compilation, { artist: "Jessica Pratt" }, []],
      [
        "compilation track on another album",
        compilation,
        { album: "Edits" },
        [["tags_disagree_with_record", "album"]],
      ],
    ])("%s", (_label, rec, overrides, expected) => {
      expect(lint(rec, [track(overrides)])[1] ?? []).toEqual(expected);
    });
  });

  describe("track numbers", () => {
    it.each<[string, TagLintTrack[], Record<number, Expected>]>([
      [
        "no track number",
        [track({ track_id: 1, track_number: null })],
        { 1: [["track_number_missing", "track_number"]] },
      ],
      [
        "two tracks share a number on one disc",
        [track({ track_id: 1 }), track({ track_id: 2, title: "Cosita Rica" })],
        { 1: [["track_number_duplicate", "track_number"]], 2: [["track_number_duplicate", "track_number"]] },
      ],
      [
        "the same number on different discs",
        [track({ track_id: 1, disc_number: 1 }), track({ track_id: 2, disc_number: 2, title: "Cosita Rica" })],
        {},
      ],
      [
        "a missing disc number counts as disc 1",
        [track({ track_id: 1, disc_number: null }), track({ track_id: 2, disc_number: 1, title: "Cosita Rica" })],
        { 1: [["track_number_duplicate", "track_number"]], 2: [["track_number_duplicate", "track_number"]] },
      ],
      [
        "consecutive numbers",
        [track({ track_id: 1 }), track({ track_id: 2, track_number: 2, title: "Cosita Rica" })],
        {},
      ],
      [
        "two tracks without numbers are missing, not duplicate",
        [track({ track_id: 1, track_number: null }), track({ track_id: 2, track_number: null, title: "Cosita Rica" })],
        { 1: [["track_number_missing", "track_number"]], 2: [["track_number_missing", "track_number"]] },
      ],
    ])("%s", (_label, tracks, expected) => {
      expect(lint(record, tracks)).toEqual(expected);
    });
  });

  describe("durations", () => {
    it.each<[string, number | null, Expected]>([
      // No `TrackTags` field holds a duration, so these issues name no field.
      ["one millisecond under 15 seconds", 14_999, [["duration_short", null]]],
      ["exactly 15 seconds", 15_000, []],
      ["a four-minute track", 240_000, []],
      ["exactly 30 minutes", 1_800_000, []],
      ["one millisecond over 30 minutes", 1_800_001, [["duration_long", null]]],
      ["an unknown duration", null, []],
    ])("%s", (_label, duration_ms, expected) => {
      expect(lint(record, [track({ duration_ms })])[1] ?? []).toEqual(expected);
    });
  });

  describe("unreadable files", () => {
    it("reports only unreadable for a track the worker could not read", () => {
      const unreadable = track({
        track_id: 2,
        track_number: null,
        title: null,
        artist: null,
        album: null,
        album_artist: null,
        duration_ms: null,
        unreadable: true,
      });
      expect(lint(record, [track({ track_id: 1 }), unreadable])).toEqual({ 2: [["unreadable", null]] });
    });

    it("leaves an unreadable track out of the cross-track comparisons", () => {
      const unreadable = track({ track_id: 2, album: "Not Doga", unreadable: true });
      expect(lint(record, [track({ track_id: 1 }), unreadable])).toEqual({ 2: [["unreadable", null]] });
    });
  });
});

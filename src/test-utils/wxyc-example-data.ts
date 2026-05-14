/**
 * WXYC Example Music Data
 *
 * Representative test data from real WXYC flowsheets and rotation.
 * Use this data when creating realistic test scenarios. These are NOT
 * replacements for the generic test fixtures (testArtist, testAlbum, etc.)
 * which remain stable for existing test assertions.
 *
 * Source: tubafrenzy/scripts/dev/fixtures/wxycmusic-fixture.sql
 * Canonical JSON: src/test-utils/wxyc-example-data.json
 */

import type {
  Artist,
  Album,
  AlbumSearchResult,
  FlowsheetSongEntry,
} from '../dtos/index.js';

import data from './wxyc-example-data.json' with { type: 'json' };

const artists = data.artists as Artist[];
const albums = data.albums as Album[];
const flowsheetEntries = data.flowsheetEntries as FlowsheetSongEntry[];
const searchResults = data.searchResults as AlbumSearchResult[];

// ============================================================================
// Artists
// ============================================================================

export const wxycExampleArtists = {
  juanaMolina: artists[0]!,
  stereolab: artists[1]!,
  catPower: artists[2]!,
  jessicaPratt: artists[3]!,
  chuquimamaniCondori: artists[4]!,
  dukeEllingtonAndJohnColtrane: artists[5]!,
  // Diacritic-bearing fixtures. Names from FLOWSHEET_ENTRY_PROD; library
  // codes synthesized (these are streaming-only artists with no LIBRARY_CODE
  // row) following the simplified 2-letter-genre convention used above.
  niluferYanya: artists[6]!, // ü
  sonidoDuenez: artists[7]!, // ñ (combining tilde)
  asiqAltay: artists[8]!, // multi-diacritic (Turkish ş + ı)
} as const;

// ============================================================================
// Albums
// ============================================================================

export const wxycExampleAlbums = {
  doga: albums[0]!,
  aluminumTunes: albums[1]!,
  moonPix: albums[2]!,
  onYourOwnLoveAgain: albums[3]!,
  edits: albums[4]!,
  painless: albums[5]!,
  rebajadas2: albums[6]!,
  musicFromTheCaucasus: albums[7]!,
} as const;

// ============================================================================
// Flowsheet Entries (FlowsheetSongEntry -- narrower type, all required fields)
// ============================================================================

// Flowsheet entries carry rotation_bin/segue/request_flag variants to exercise
// Classic-mode capsule and segue rendering:
//   - juanaMolinaLaParadoja        → rotation_bin: 'H'  (heavy)
//   - jessicaPrattBackBaby         → rotation_bin: 'M'  (medium)
//   - chuquimamaniCondoriCallYourName → rotation_bin: 'L'  (light)
//   - dukeEllingtonSentimentalMood → request_flag: true
//   - niluferYanyaMidnightSun      → rotation_bin: 'S'  (singles)
//   - asiqAltayBayatiShiraz        → segue: true (follows asiqAltayHuseyni, same album)
export const wxycExampleFlowsheetEntries = {
  juanaMolinaLaParadoja: flowsheetEntries[0]!,
  jessicaPrattBackBaby: flowsheetEntries[1]!,
  chuquimamaniCondoriCallYourName: flowsheetEntries[2]!,
  dukeEllingtonSentimentalMood: flowsheetEntries[3]!,
  niluferYanyaMidnightSun: flowsheetEntries[4]!,
  sonidoDuenezMentirosoBoquisabroso: flowsheetEntries[5]!,
  asiqAltayHuseyni: flowsheetEntries[6]!,
  asiqAltayBayatiShiraz: flowsheetEntries[7]!,
} as const;

// ============================================================================
// Album Search Results
// ============================================================================

// Search results cover the visible variants exercised by Classic catalog rows:
//   - doga                  → plain (no rotation, no on_streaming flag)
//   - moonPix               → plain
//   - aluminumTunesExclusive → on_streaming: false (EXCLUSIVE capsule)
//   - painlessRotationS     → rotation_bin: 'S', on_streaming: true (ROTATION capsule)
//   - variousArtistsComp    → album_artist: 'Various Artists' (V/A credited)
export const wxycExampleSearchResults = {
  doga: searchResults[0]!,
  moonPix: searchResults[1]!,
  aluminumTunesExclusive: searchResults[2]!,
  painlessRotationS: searchResults[3]!,
  variousArtistsComp: searchResults[4]!,
} as const;

// ============================================================================
// Convenience arrays for iteration / random selection
// ============================================================================

export const wxycExampleArtistList = Object.values(wxycExampleArtists);
export const wxycExampleAlbumList = Object.values(wxycExampleAlbums);
export const wxycExampleFlowsheetList = Object.values(wxycExampleFlowsheetEntries);

// ============================================================================
// Canonical Artist Names (broader pool, names only)
// ============================================================================
//
// Representative WXYC artists with 100+ flowsheet plays. Use for graph
// examples, presentation data, large seed sets, and documentation samples
// where you need names but not full Artist DB rows.
//
// Sourced from freeform-map-talk/canonical-artists.json.

export const wxycCanonicalArtistNames: readonly string[] =
  data.canonicalArtistNames as string[];

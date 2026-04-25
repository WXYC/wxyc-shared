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
} as const;

// ============================================================================
// Flowsheet Entries (FlowsheetSongEntry -- narrower type, all required fields)
// ============================================================================

export const wxycExampleFlowsheetEntries = {
  juanaMolinaLaParadoja: flowsheetEntries[0]!,
  jessicaPrattBackBaby: flowsheetEntries[1]!,
  chuquimamaniCondoriCallYourName: flowsheetEntries[2]!,
  dukeEllingtonSentimentalMood: flowsheetEntries[3]!,
} as const;

// ============================================================================
// Album Search Results
// ============================================================================

export const wxycExampleSearchResults = {
  doga: searchResults[0]!,
  moonPix: searchResults[1]!,
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

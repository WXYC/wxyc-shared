/**
 * postgenerate:swift hook (WXYC/wxyc-shared#357) — copies hand-vendored Swift
 * support types (openapi-config/swift-support/*.swift) into the generated
 * package after `generate:swift` runs. npm runs `post<script>` hooks
 * automatically, so this becomes ordinary generator output with no
 * per-consumer injection step anywhere.
 *
 * Why this exists at all: openapi-generator's `typeMappings` (see
 * `date: CalendarDate` in openapi-config/swift6.yaml) only substitutes a type
 * *name* wherever `format: date` appears — it does not synthesize the type
 * itself. Without this copy step, the generated package would reference
 * `CalendarDate` and fail to compile.
 *
 * The destination directory is *derived* from swift6.yaml's own
 * `projectName` + `useSPMFileStructure` (see `deriveModelsRoot` below), not
 * hardcoded, because this repo's CI never runs `generate:swift` (no Java
 * step here) — a `projectName` rename is the one desync a plain "does the
 * file exist" check can't catch. `deriveModelsRoot`/`loadSwift6Config` are
 * exported so tests/codegen-output-paths.test.ts can assert the derivation
 * itself, not just the current output of it.
 */

import { readFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';
import YAML from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** Parses openapi-config/swift6.yaml, the single source of truth for `projectName`. */
export function loadSwift6Config(root = repoRoot) {
  const configPath = join(root, 'openapi-config', 'swift6.yaml');
  return YAML.parse(readFileSync(configPath, 'utf-8'));
}

/**
 * Derives generate:swift's model-package root (relative to the repo root)
 * from a parsed swift6.yaml config, mirroring how the swift6 generator
 * itself lays out output: `useSPMFileStructure: true` (this repo's setting)
 * emits `Sources/<projectName>/...`; `false` falls back to the generator's
 * default `Classes/OpenAPIs/` layout. Never hardcode `WXYCAPI` here --
 * always read `config.projectName`.
 */
export function deriveModelsRoot(config) {
  const projectName = config.projectName;
  if (!projectName) {
    throw new Error(
      'openapi-config/swift6.yaml has no projectName -- cannot derive the postgenerate:swift destination',
    );
  }
  return config.useSPMFileStructure
    ? join('generated', 'swift', 'Sources', projectName)
    : join('generated', 'swift', 'Classes', 'OpenAPIs');
}

function main() {
  const config = loadSwift6Config();
  const modelsRoot = deriveModelsRoot(config);
  const destinationDir = join(repoRoot, modelsRoot, 'Infrastructure');
  const sourceDir = join(repoRoot, 'openapi-config', 'swift-support');

  const supportFiles = readdirSync(sourceDir).filter((f) => f.endsWith('.swift'));
  if (supportFiles.length === 0) {
    throw new Error('openapi-config/swift-support has no .swift files to copy');
  }

  mkdirSync(destinationDir, { recursive: true });

  for (const file of supportFiles) {
    copyFileSync(join(sourceDir, file), join(destinationDir, file));
    console.log(`  copied openapi-config/swift-support/${file} -> ${join(modelsRoot, 'Infrastructure', file)}`);
  }
}

// Only run the copy when executed directly (npm run postgenerate:swift) --
// not when imported by tests for the pure derivation functions above.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

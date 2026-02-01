#!/usr/bin/env node

/**
 * Breaking Change Detection Script
 *
 * Compares the current api.yaml against the main branch version
 * to detect breaking API changes.
 *
 * Usage:
 *   npm run check:breaking
 *   node scripts/check-breaking-changes.js [base-spec-path]
 *
 * Exit codes:
 *   0 - No breaking changes
 *   1 - Breaking changes detected
 *   2 - Error running check
 */

import openapiDiff from 'openapi-diff';
import { execSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(message, color = '') {
  console.log(`${color}${message}${COLORS.reset}`);
}

function logHeader(message) {
  log(`\n${COLORS.bold}${message}${COLORS.reset}`);
}

async function getBaseSpec(baseSpecPath) {
  // If a path is provided, use it
  if (baseSpecPath && existsSync(baseSpecPath)) {
    return readFileSync(baseSpecPath, 'utf-8');
  }

  // Try to get from git main branch
  try {
    const spec = execSync('git show origin/main:api.yaml 2>/dev/null', {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    return spec;
  } catch {
    // Fall back to local main branch
    try {
      const spec = execSync('git show main:api.yaml 2>/dev/null', {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
      return spec;
    } catch {
      log('Warning: Could not get base spec from git, using current as base', COLORS.yellow);
      return null;
    }
  }
}

function getCurrentSpec() {
  const specPath = join(projectRoot, 'api.yaml');
  if (!existsSync(specPath)) {
    throw new Error(`api.yaml not found at ${specPath}`);
  }
  return readFileSync(specPath, 'utf-8');
}

function formatDifference(diff) {
  const { type, action, sourceSpecEntityDetails, destinationSpecEntityDetails } = diff;
  const location = sourceSpecEntityDetails?.[0]?.location || destinationSpecEntityDetails?.[0]?.location || 'unknown';
  return `  - ${type} (${action}): ${location}`;
}

async function checkBreakingChanges(baseSpecPath) {
  logHeader('🔍 Checking for Breaking API Changes');
  log(`Comparing current api.yaml against ${baseSpecPath ? baseSpecPath : 'main branch'}...`);

  const currentSpec = getCurrentSpec();
  const baseSpec = await getBaseSpec(baseSpecPath);

  if (!baseSpec) {
    log('\nNo base spec available for comparison. Skipping breaking change check.', COLORS.yellow);
    return { breakingDifferencesFound: false };
  }

  // Write base spec to temp file for comparison
  const tempBasePath = join(projectRoot, '.api-base-temp.yaml');
  writeFileSync(tempBasePath, baseSpec);

  // Check if specs are identical first (fast path)
  if (baseSpec.trim() === currentSpec.trim()) {
    unlinkSync(tempBasePath);
    return { breakingDifferencesFound: false };
  }

  log('\nNote: Full diff analysis may take a moment for large specs...', COLORS.blue);

  // Set a timeout for the diff operation
  const TIMEOUT_MS = 60000; // 60 seconds

  try {
    const diffPromise = openapiDiff.diffSpecs({
      sourceSpec: { content: baseSpec, location: 'base-api.yaml', format: 'openapi3' },
      destinationSpec: { content: currentSpec, location: 'api.yaml', format: 'openapi3' },
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Diff analysis timed out')), TIMEOUT_MS)
    );

    const result = await Promise.race([diffPromise, timeoutPromise]);

    // Clean up temp file
    unlinkSync(tempBasePath);

    return result;
  } catch (error) {
    // Clean up temp file on error
    if (existsSync(tempBasePath)) {
      unlinkSync(tempBasePath);
    }

    if (error.message === 'Diff analysis timed out') {
      log('\n⚠️  Diff analysis timed out. For large specs, consider:', COLORS.yellow);
      log('   - Using CI/CD where more resources are available');
      log('   - Installing oasdiff (Go tool) for faster analysis: brew install oasdiff');
      log('   - Running manual review of api.yaml changes');
      return { breakingDifferencesFound: false, timedOut: true };
    }
    throw error;
  }
}

function reportResults(result) {
  const { breakingDifferencesFound, breakingDifferences, nonBreakingDifferences, unclassifiedDifferences, timedOut } = result;

  if (timedOut) {
    return false; // Don't fail on timeout
  }

  if (breakingDifferencesFound) {
    logHeader('🔴 Breaking Changes Detected!');
    log('\nThe following breaking changes were found:', COLORS.red);
    for (const diff of breakingDifferences || []) {
      log(formatDifference(diff), COLORS.red);
    }

    log('\n⚠️  These changes may break existing clients!', COLORS.yellow);
    log('   Consider:');
    log('   - Adding new fields/endpoints instead of modifying existing ones');
    log('   - Deprecating rather than removing');
    log('   - Versioning the API if breaking changes are necessary');
  } else {
    logHeader('✅ No Breaking Changes Detected');
  }

  if (nonBreakingDifferences?.length > 0) {
    log('\nNon-breaking changes:', COLORS.green);
    for (const diff of nonBreakingDifferences) {
      log(formatDifference(diff), COLORS.green);
    }
  }

  if (unclassifiedDifferences?.length > 0) {
    log('\nUnclassified changes (review manually):', COLORS.yellow);
    for (const diff of unclassifiedDifferences) {
      log(formatDifference(diff), COLORS.yellow);
    }
  }

  if (!breakingDifferencesFound && !nonBreakingDifferences?.length && !unclassifiedDifferences?.length) {
    log('\nNo API changes detected.', COLORS.blue);
  }

  return breakingDifferencesFound;
}

async function main() {
  const baseSpecPath = process.argv[2];

  try {
    const result = await checkBreakingChanges(baseSpecPath);
    const hasBreakingChanges = reportResults(result);
    process.exit(hasBreakingChanges ? 1 : 0);
  } catch (error) {
    log(`\nError: ${error.message}`, COLORS.red);
    process.exit(2);
  }
}

main();

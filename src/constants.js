// Lightweight constants with NO heavy imports — safe to load at startup.
export const PACKAGE_FILE = 'package.xml';
export const DESTRUCTIVE_FILE = 'destructiveChanges.xml';
export const EMPTY_PACKAGE_FILE = 'empty-package.xml';
export const STATE_FILE = '.selection.json';

// Minutes to wait for a retrieve/deploy to finish before the sf CLI gives up.
// Overridable per-run with --wait.
export const DEFAULT_WAIT_MINUTES = 60;

// Salesforce Metadata API / sf CLI test levels.
export const TEST_LEVELS = [
    'NoTestRun', // deploy only — validate falls back to a check-only dry-run
    'RunSpecifiedTests',
    'RunLocalTests',
    'RunAllTestsInOrg',
    'RunRelevantTests', // API 66+ (Spring '26, beta): runs only the tests relevant to the deploy
];

// RunRelevantTests was introduced in API v66 and the sf CLI rejects it below that.
export const RELEVANT_TESTS_MIN_API = 66;

/** Parse an apiVersion like "62.0" → 62 (null if unparseable). */
export function apiMajor(apiVersion) {
    const n = parseInt(String(apiVersion ?? ''), 10);
    return Number.isNaN(n) ? null : n;
}

/** True when RunRelevantTests is chosen but the API version is too old for it. */
export function relevantTestsUnsupported(testLevel, apiVersion) {
    if (testLevel !== 'RunRelevantTests') return false;
    const major = apiMajor(apiVersion);
    return major != null && major < RELEVANT_TESTS_MIN_API;
}

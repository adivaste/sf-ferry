// Lightweight constants with NO heavy imports — safe to load at startup.
export const PACKAGE_FILE = 'package.xml';
export const DESTRUCTIVE_FILE = 'destructiveChanges.xml';
export const EMPTY_PACKAGE_FILE = 'empty-package.xml';
export const STATE_FILE = '.selection.json';

// Minutes to wait for a retrieve/deploy to finish before the sf CLI gives up.
// Overridable per-run with --wait.
export const DEFAULT_WAIT_MINUTES = 60;

// The four levels the Salesforce Metadata API / sf CLI actually accept.
export const TEST_LEVELS = [
    'NoTestRun', // deploy only — validate falls back to a check-only dry-run
    'RunSpecifiedTests',
    'RunLocalTests',
    'RunAllTestsInOrg',
];

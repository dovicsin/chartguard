/**
 * Chart config findings in JavaScript and TypeScript source, with the edits the engine verified
 * (CG-06-04): one source of truth for the ESLint plugin and the language server.
 */
export { type FindingKind, SourceChecker, type SourceFinding } from './check.js';
export type { TextEdit } from './edits.js';
export { type ChartGuardSettings, SettingsError } from './settings.js';

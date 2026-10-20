export type { AnalysisOutput, ExtractOptions, SourceObject } from './extract.js';
export { extractStaticConfigs } from './extract.js';
export type { ChartLibrary, ChartPattern } from './patterns.js';
export { PatternError } from './patterns.js';
export type { Binding } from './scope.js';
export type { PathFact, SourceRange, UnknownReason } from './trace.js';
export { rangeAt } from './trace.js';
export type { ChartUse } from './uses.js';
/** The bounds of one analysis (CG-03-08): files beyond them are refused, work beyond them is left unknown. */
export { MAX_DECODE_STEPS } from './decoder.js';
export { MAX_NESTING, MAX_SOURCE_LENGTH } from './limits.js';
export { MAX_FACTS } from './trace.js';

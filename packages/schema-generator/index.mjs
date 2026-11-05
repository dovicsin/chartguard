/**
 * Generates ChartGuard schema artifacts from the chart libraries' own published declarations and
 * runtime code. `root` is always the project whose `node_modules` holds the library; nothing from
 * it is executed, only read.
 */
export { digestOf, omit, serialize, withDigest } from './lib/digest.mjs';
export { generateArtifact, isRedistributable, LIBRARIES } from './lib/generate.mjs';
export { buildLocalSchema } from './lib/local.mjs';
export {
	compilerPin,
	contentIntegrity,
	installedUpstream,
	pinOf,
	sourceDirectory,
	UpstreamError,
	verifiedCompiler,
	verifiedUpstream
} from './lib/lock.mjs';
export { LOCAL_ARTIFACTS, localSchemaPath } from './lib/paths.mjs';
export { untracedFacts } from './lib/trace.mjs';

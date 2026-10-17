import type { SchemaManifest } from '../schema.js';
import { checkArtifact } from './check.js';
import { lowerArtifact } from './lower.js';

/** Checks and lowers an artifact; throws one error listing every problem. */
export function manifestFromArtifact(value: unknown): SchemaManifest {
	const { artifact, problems } = checkArtifact(value);
	if (artifact === undefined) throw new Error(`Invalid schema artifact:\n${problems.join('\n')}`);
	return lowerArtifact(artifact).manifest;
}

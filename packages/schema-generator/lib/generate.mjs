import { checkArtifact } from '@chartguard/config-core';

import { generateChartjs } from './chartjs.mjs';
import { serialize, withDigest } from './digest.mjs';
import { generateEcharts } from './echarts.mjs';
import { generateHighcharts } from './highcharts.mjs';
import { untracedFacts } from './trace.mjs';

const GENERATORS = { chartjs: generateChartjs, echarts: generateEcharts, highcharts: generateHighcharts };

/** The libraries this generator builds schema artifacts for: `chartjs`, `echarts`, `highcharts`. */
export const LIBRARIES = Object.keys(GENERATORS);

/** Upstream licenses under which a derived artifact may be committed and published. */
const REDISTRIBUTABLE = new Set(['allowed-with-attribution', 'allowed-with-license-and-notice']);

/** Whether the pin's upstream license lets an artifact derived from it be committed and published. */
export function isRedistributable(pin) {
	return REDISTRIBUTABLE.has(pin.license.redistribution);
}

/**
 * The artifact for `library` from the install under `root`, as deterministic text carrying the
 * digest of its own content; never a malformed one, nor one with a fact that does not trace to its source.
 */
export function generateArtifact(root, library, pin) {
	const artifact = withDigest(GENERATORS[library](root, pin));
	const { problems } = checkArtifact(artifact);
	if (problems.length > 0)
		throw new Error(`${library}: generated artifact is malformed:\n${problems.slice(0, 20).join('\n')}`);
	const untraced = untracedFacts(root, artifact);
	if (untraced.length > 0)
		throw new Error(`${library}: generated facts do not trace to their source:\n${untraced.slice(0, 20).join('\n')}`);
	return { artifact, text: serialize(artifact) };
}

import type { QualityReport } from '@chartguard/core';
import {
	type ChartSemantics,
	type Default,
	isBoolean,
	itemsAt,
	type Listed,
	type QualityOptions,
	readFact,
	review,
	type SeriesSemantics,
	unknown,
	withFixes
} from '@chartguard/quality-core';

import { asText, axesOf } from './axes.js';
import { REMEDIES } from './fixes.js';
import { motionOf } from './motion.js';
import { scalesOf } from './scales.js';
import { addedScales, seriesOf } from './series.js';

const TITLE_SHOWN: Default<boolean> = { value: false, pointer: 'chart.js@4.5.1 dist/chart.js:8960 display: false,' };

/** Chart.js titles are a string or one string per line. */
const isText = (value: unknown): value is string | string[] =>
	typeof value === 'string' || (Array.isArray(value) && (value as unknown[]).every((line) => typeof line === 'string'));

/** The Chart.js config as library-neutral chart semantics (CG-05-02, CG-05-03). */
export function normalize(config: unknown): ChartSemantics {
	const datasets = itemsAt(config, ['data', 'datasets']);
	const scales = scalesOf(config, datasets, addedScales(config));
	const series: Listed<SeriesSemantics> = datasets.known
		? { ...datasets, items: datasets.items.map((item) => seriesOf(config, item, scales, datasets)) }
		: datasets;
	const titleAt = ['options', 'plugins', 'title'];
	return {
		library: 'chartjs',
		title: {
			text: asText(readFact(config, [...titleAt, 'text'], isText)),
			shown: readFact(config, [...titleAt, 'display'], isBoolean, TITLE_SHOWN)
		},
		series,
		axes: axesOf(config, { series, datasets }, scales),
		// A canvas gets its text alternative and keyboard access from the page, not from the config.
		access: { dataDescribed: unknown('$', 'page'), keyboard: unknown('$', 'page') },
		// A canvas is transparent and Chart.js paints no background: the page behind it is the background.
		background: unknown('$', 'page'),
		motion: motionOf(config, datasets)
	};
}

/** The options `analyze` takes, and their check: re-exported so a consumer needs only this adapter. */
export type { QualityOptions } from '@chartguard/quality-core';
export { assertQualityOptions, QualityOptionsError } from '@chartguard/quality-core';

/** The rules' advisory findings on the config, shaped by the caller's rule settings and context (CG-05-05). */
export function analyze(config: unknown, options?: QualityOptions): QualityReport {
	const reviewed = (input: unknown): QualityReport => review(normalize(input), options);
	// Each fix is offered only when the config with it applied, reviewed the same way, no longer has the finding nor a new one.
	return withFixes(reviewed(config), config, REMEDIES, reviewed);
}

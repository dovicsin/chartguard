import type { QualityReport } from '@chartguard/core';
import {
	type ChartSemantics,
	type Default,
	isBoolean,
	itemsAt,
	type Listed,
	readFact,
	review,
	type SeriesSemantics
} from '@chartguard/quality-core';

import { asText, axesOf } from './axes.js';
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
		? { ...datasets, items: datasets.items.map((item) => seriesOf(config, item, scales)) }
		: datasets;
	const titleAt = ['options', 'plugins', 'title'];
	return {
		library: 'chartjs',
		title: {
			text: asText(readFact(config, [...titleAt, 'text'], isText)),
			shown: readFact(config, [...titleAt, 'display'], isBoolean, TITLE_SHOWN)
		},
		series,
		axes: axesOf(config, series, scales)
	};
}

export function analyze(config: unknown): QualityReport {
	return review(normalize(config));
}

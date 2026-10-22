import type { QualityReport } from '@chartguard/core';
import {
	type AccessSemantics,
	type ChartSemantics,
	contrastRatio,
	type Default,
	type Fact,
	isBoolean,
	isString,
	itemsAt,
	type Listed,
	readFact,
	readPath,
	review,
	sameShades,
	type SeriesSemantics,
	type Shades,
	unknown
} from '@chartguard/quality-core';

import { axesOf } from './axes.js';
import { seriesColors } from './color.js';
import { motionOf } from './motion.js';
import { seriesOf } from './series.js';

const TITLE_SHOWN: Default<boolean> = { value: true, pointer: 'echarts@6.1.0 dist/echarts.js:84452 show: true,' };
/** Without `aria.enabled` echarts describes nothing; with it, its label (a generated description) is on by default. */
const ARIA: Default<boolean> = {
	value: false,
	pointer: "echarts@6.1.0 dist/echarts.js:92032 if (!ariaModel.get('enabled')) {"
};
const ARIA_LABEL: Default<boolean> = { value: true, pointer: 'echarts@6.1.0 dist/echarts.js:92020 enabled: true' };

function accessOf(config: unknown): AccessSemantics {
	const enabled = readFact(config, ['aria', 'enabled'], isBoolean, ARIA);
	const described =
		enabled.known && enabled.value ? readFact(config, ['aria', 'label', 'enabled'], isBoolean, ARIA_LABEL) : enabled;
	// echarts has no keyboard navigation of its own: not something the config decides.
	return { dataDescribed: described, keyboard: unknown('$', 'unmodelled') };
}

/**
 * The background: the option's `backgroundColor` when it is opaque. Without one echarts draws none
 * (`ecModel.get('backgroundColor') || 'transparent'`, dist/echarts.js:29469) and the page shows
 * through; a grid that draws its own background (`grid.show`) is not modelled.
 */
function backgroundOf(config: unknown): Fact<Shades> {
	const grid = readFact(config, ['grid', 'show'], isBoolean);
	if (!grid.known && grid.reason !== 'unset') return grid;
	if (grid.known && grid.value) return unknown(grid.path, 'unmodelled');
	const color = readFact(config, ['backgroundColor'], isString);
	if (!color.known) return color.reason === 'unset' ? unknown(color.path, 'unmodelled') : color;
	return contrastRatio('#000', color.value) === undefined ? unknown(color.path, 'unmodelled') : sameShades(color);
}

/** Without a title (or its text) echarts draws none. */
const TITLE_TEXT: Default<string> = { value: '', pointer: "echarts@6.1.0 dist/echarts.js:84453 text: ''," };

/** The ECharts option as library-neutral chart semantics (CG-05-02, CG-05-03). Several titles stay unknown: none is guessed. */
export function normalize(config: unknown): ChartSemantics {
	const items = itemsAt(config, ['series'], { single: true });
	const colors = seriesColors(config, items);
	const several = Array.isArray(readPath(config, ['title']));
	const series: Listed<SeriesSemantics> = items.known
		? {
				...items,
				items: items.items.map((item, index) =>
					seriesOf(config, item, colors[index] ?? unknown(item.path, 'unmodelled'))
				)
			}
		: items;
	return {
		library: 'echarts',
		title: {
			text: several ? unknown('$.title', 'unmodelled') : readFact(config, ['title', 'text'], isString, TITLE_TEXT),
			shown: several ? unknown('$.title', 'unmodelled') : readFact(config, ['title', 'show'], isBoolean, TITLE_SHOWN)
		},
		series,
		axes: axesOf(config, series),
		access: accessOf(config),
		background: backgroundOf(config),
		motion: motionOf(config, items)
	};
}

export function analyze(config: unknown): QualityReport {
	return review(normalize(config));
}

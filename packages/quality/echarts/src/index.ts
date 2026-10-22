import type { QualityReport } from '@chartguard/core';
import {
	type ChartSemantics,
	type Default,
	isBoolean,
	isString,
	itemsAt,
	readFact,
	readPath,
	review,
	unknown
} from '@chartguard/quality-core';

import { axesOf } from './axes.js';
import { seriesColors } from './color.js';
import { seriesOf } from './series.js';

const TITLE_SHOWN: Default<boolean> = { value: true, pointer: 'echarts@6.1.0 dist/echarts.js:84452 show: true,' };
/** Without a title (or its text) echarts draws none. */
const TITLE_TEXT: Default<string> = { value: '', pointer: "echarts@6.1.0 dist/echarts.js:84453 text: ''," };

/** The ECharts option as library-neutral chart semantics (CG-05-02, CG-05-03). Several titles stay unknown: none is guessed. */
export function normalize(config: unknown): ChartSemantics {
	const items = itemsAt(config, ['series'], { single: true });
	const colors = seriesColors(config, items);
	const several = Array.isArray(readPath(config, ['title']));
	return {
		library: 'echarts',
		title: {
			text: several ? unknown('$.title', 'unmodelled') : readFact(config, ['title', 'text'], isString, TITLE_TEXT),
			shown: several ? unknown('$.title', 'unmodelled') : readFact(config, ['title', 'show'], isBoolean, TITLE_SHOWN)
		},
		series: items.known
			? {
					...items,
					items: items.items.map((item, index) =>
						seriesOf(config, item, colors[index] ?? unknown(item.path, 'unmodelled'))
					)
				}
			: items,
		axes: axesOf(config)
	};
}

export function analyze(config: unknown): QualityReport {
	return review(normalize(config));
}

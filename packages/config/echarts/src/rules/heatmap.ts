import { type ConfigRule, itemsOf, readOwn } from '@chartguard/config-core';

import { isIndex, isWholeOption, itemsAt, textAt } from './read.js';

/** The series a visualMap targets: every one, or the listed indices; undefined when it names them by id or name. */
type Targets = 'all' | ReadonlySet<number>;

function indexList(value: unknown): ReadonlySet<number> | undefined {
	if (isIndex(value)) return new Set([value]);
	const indices = Array.isArray(value) ? itemsOf(value, '')?.map((item) => item.value) : undefined;
	return indices?.every(isIndex) === true ? new Set(indices.filter(isIndex)) : undefined;
}

function targetsOf(visualMap: unknown): Targets | undefined {
	for (const key of ['seriesId', 'seriesName']) {
		const read = readOwn(visualMap, key);
		if (!read.known || read.value !== undefined) return undefined;
	}
	const index = readOwn(visualMap, 'seriesIndex');
	if (!index.known) return undefined;
	return index.value === undefined || index.value === 'all' ? 'all' : indexList(index.value);
}

/**
 * `HeatmapView.render` (echarts/lib/chart/heatmap/HeatmapView.js) throws "Heatmap must use with
 * visualMap" for a heatmap series no visualMap targets; a visualMap targets every series unless its
 * `seriesIndex` (or `seriesId`/`seriesName`, which this rule does not resolve) narrows it.
 */
export const heatmapVisualMap: ConfigRule = {
	id: 'echarts/heatmap-visual-map',
	check(option, context) {
		const series = isWholeOption(option) ? itemsAt(option, 'series') : undefined;
		const visualMaps = itemsAt(option, 'visualMap');
		const targets = visualMaps?.map((visualMap) => targetsOf(visualMap.value));
		if (series === undefined || targets === undefined || targets.includes(undefined)) return [];
		const covered = (index: number): boolean =>
			targets.some((target) => target === 'all' || target?.has(index) === true);
		return series
			.filter((item) => textAt(item.value, 'type') === 'heatmap' && !covered(item.index))
			.map((item) =>
				context.rejected(
					'CFG_REQUIRES',
					item.path,
					'A heatmap series needs a visualMap that targets it; the runtime throws ("Heatmap must use with visualMap").',
					'Add a visualMap whose seriesIndex includes this series.'
				)
			);
	}
};

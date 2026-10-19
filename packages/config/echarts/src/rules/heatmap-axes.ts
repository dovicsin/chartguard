import { type ConfigRule, type Item, readOwn, type RuleContext } from '@chartguard/config-core';
import type { Diagnostic } from '@chartguard/core';

import { AXES, axisIndex, onCartesian } from './cartesian.js';
import { isWholeOption, itemsAt, textAt } from './read.js';

/** The axis type the runtime resolves (`getAxisType`: `type || (data ? 'category' : 'value')`); undefined when unreadable. */
function axisType(axis: unknown): string | undefined {
	const type = textAt(axis, 'type');
	if (type !== null) return type;
	const data = readOwn(axis, 'data');
	if (!data.known) return undefined;
	// The runtime's own truthiness test: an empty array is data, an empty string is not.
	return Boolean(data.value) ? 'category' : 'value';
}

/** Whether the axis is on band (`boundaryGap`, true by default on a category axis); undefined when unreadable. */
function onBand(axis: unknown): boolean | undefined {
	const gap = readOwn(axis, 'boundaryGap');
	if (!gap.known) return undefined;
	return gap.value === undefined || Boolean(gap.value);
}

function axisProblem(axis: unknown, name: string): string | undefined {
	const type = axisType(axis);
	if (type !== undefined && type !== 'category')
		return `A heatmap on cartesian2d needs a category ${name}, not "${type}"; the runtime throws ("Heatmap on cartesian must have two category axes").`;
	if (type === 'category' && onBand(axis) === false)
		return `A heatmap on cartesian2d needs ${name}.boundaryGap true; the runtime throws ("Heatmap on cartesian must have two axes with boundaryGap true").`;
	return undefined;
}

function problems(option: unknown, series: Item, context: RuleContext): Diagnostic[] {
	return AXES.flatMap((name) => {
		const index = axisIndex(series.value, name);
		const axis = index === undefined ? undefined : itemsAt(option, name)?.[index];
		const message = axis === undefined ? undefined : axisProblem(axis.value, name);
		return message === undefined ? [] : [context.rejected('CFG_REQUIRES', series.path, message)];
	});
}

/**
 * `HeatmapView._renderOnGridLike` (echarts/lib/chart/heatmap/HeatmapView.js) throws for a heatmap
 * on cartesian2d unless both of its axes are category axes on band. A missing axis is the
 * `cartesian-axes` rule's finding, not this one's.
 */
export const heatmapCategoryAxes: ConfigRule = {
	id: 'echarts/heatmap-category-axes',
	check(option, context) {
		const series = isWholeOption(option) ? itemsAt(option, 'series') : undefined;
		const heatmaps = (series ?? []).filter(
			(item) => textAt(item.value, 'type') === 'heatmap' && onCartesian(item.value) === true
		);
		return heatmaps.flatMap((item) => problems(option, item, context));
	}
};

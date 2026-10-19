import { type ConfigRule, type Item, readOwn, type RuleContext } from '@chartguard/config-core';
import type { Diagnostic } from '@chartguard/core';

import { isIndex, isWholeOption, itemsAt, textAt } from './read.js';

/** Series types whose `coordinateSystem` defaults to `cartesian2d` (their `defaultOption` in echarts/lib/chart). */
const CARTESIAN_BY_DEFAULT: ReadonlySet<string> = new Set([
	'line',
	'bar',
	'pictorialBar',
	'scatter',
	'effectScatter',
	'candlestick',
	'boxplot',
	'heatmap',
	'custom'
]);
export const AXES = ['xAxis', 'yAxis'] as const;

/** Whether the series is laid out on cartesian2d; undefined when that cannot be read. */
export function onCartesian(series: unknown): boolean | undefined {
	const system = textAt(series, 'coordinateSystem');
	if (system === undefined) return undefined;
	if (system !== null) return system === 'cartesian2d';
	const type = textAt(series, 'type');
	return typeof type === 'string' && CARTESIAN_BY_DEFAULT.has(type);
}

/** The axis index a series refers to (default 0); undefined when it refers by id or cannot be read. */
export function axisIndex(series: unknown, axis: string): number | undefined {
	const id = readOwn(series, `${axis}Id`);
	const index = readOwn(series, `${axis}Index`);
	if (!id.known || id.value !== undefined || !index.known) return undefined;
	if (index.value === undefined) return 0;
	return isIndex(index.value) ? index.value : undefined;
}

function missingAxis(option: unknown, item: Item, context: RuleContext): Diagnostic[] {
	const type = textAt(item.value, 'type');
	const kind = typeof type === 'string' ? `${type} series` : 'series';
	return AXES.flatMap((axis) => {
		const index = axisIndex(item.value, axis);
		const count = itemsAt(option, axis)?.length;
		if (index === undefined || count === undefined || index < count) return [];
		const hint =
			count === 0 ? `Add ${axis}.` : `Use ${axis}Index 0..${String(count - 1)}, or add ${axis} ${String(index)}.`;
		const message = `A ${kind} on cartesian2d needs ${axis} ${String(index)}; the runtime throws ("${axis} "${String(index)}" not found").`;
		return [context.rejected('CFG_REQUIRES', item.path, message, hint)];
	});
}

/**
 * `getCoordSysInfoBySeries` (echarts/lib/model/referHelper.js) throws `xAxis "0" not found` for a
 * cartesian2d series whose `xAxisIndex`/`yAxisIndex` (default 0) names no axis. A reference by
 * `xAxisId` is not resolved here.
 */
export const cartesianAxes: ConfigRule = {
	id: 'echarts/cartesian-axes',
	check(option, context) {
		const series = isWholeOption(option) ? itemsAt(option, 'series') : undefined;
		return (series ?? [])
			.filter((item) => onCartesian(item.value) === true)
			.flatMap((item) => missingAxis(option, item, context));
	}
};

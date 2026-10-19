import { type ConfigRule, itemsOf, type Read, readOwn, type RuleContext } from '@chartguard/config-core';
import type { Diagnostic } from '@chartguard/core';

/** Whether Filler is not enabled: not registered, or switched off with `options.plugins.filler: false`; undefined when unknown. */
function fillerDisabled(config: unknown, context: RuleContext): boolean | undefined {
	const option = readOwn(config, 'options', 'plugins', 'filler');
	if (!option.known) return undefined;
	if (option.value === false) return true;
	const registered = context.registered('chartjs.plugins', 'filler');
	return registered === undefined ? undefined : !registered;
}

interface Found {
	readonly path: string;
	readonly read: Read;
}

/** The dataset's controller type: its own `type`, else the chart's; undefined when unreadable. */
function datasetType(config: unknown, dataset: unknown): unknown {
	const own = readOwn(dataset, 'type');
	if (!own.known) return undefined;
	if (own.value !== undefined) return own.value;
	const chart = readOwn(config, 'type');
	return chart.known ? chart.value : undefined;
}

/** The scopes a dataset's `fill` resolves through (`datasetScopeKeys`): the dataset, `options.datasets.<type>`, `options`. */
function fillScopes(config: unknown, dataset: unknown, path: string): Found[] {
	const type = datasetType(config, dataset);
	const scopes: Found[] = [{ path: `${path}.fill`, read: readOwn(dataset, 'fill') }];
	if (typeof type === 'string')
		scopes.push({
			path: `$.options.datasets.${type}.fill`,
			read: readOwn(config, 'options', 'datasets', type, 'fill')
		});
	else scopes.push({ path: '', read: { known: false } });
	scopes.push({ path: '$.options.fill', read: readOwn(config, 'options', 'fill') });
	return scopes;
}

/** Where a truthy, literal `fill` reaches this dataset from; undefined when none does or it cannot be read. */
function effectiveFill(scopes: readonly Found[]): string | undefined {
	for (const { path, read } of scopes) {
		if (!read.known || typeof read.value === 'function') return undefined;
		if (read.value !== undefined) return read.value ? path : undefined;
	}
	return undefined;
}

/**
 * `DatasetController.initialize` (chart.js/dist/chart.js) warns "Tried to use the 'fill' option
 * without the 'Filler' plugin enabled" when a dataset's resolved `fill` is truthy and Filler is not
 * enabled; the fill is then not drawn.
 */
const fillNeedsFiller: ConfigRule = {
	id: 'chartjs/fill-needs-filler',
	check(config, context) {
		const datasets = readOwn(config, 'data', 'datasets');
		const items = datasets.known ? itemsOf(datasets.value, '$.data.datasets') : undefined;
		if (fillerDisabled(config, context) !== true || items === undefined) return [];
		const paths = new Set(items.flatMap((item) => effectiveFill(fillScopes(config, item.value, item.path)) ?? []));
		return [...paths].map((path): Diagnostic =>
			context.warned(
				'CFG_INEFFECTIVE',
				path,
				'"fill" needs the Filler plugin, which is not enabled; the runtime warns ("Tried to use the \'fill\' option without the \'Filler\' plugin enabled") and draws no fill.',
				'Register the Filler plugin (Chart.register(Filler)) and do not disable it in options.plugins.'
			)
		);
	}
};

/** Rules over several options at once, each mirroring a check of the chart.js 4.5.1 runtime (CG-02-08). */
export const RULES: readonly ConfigRule[] = [fillNeedsFiller];

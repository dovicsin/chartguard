const LIBRARIES = ['chartjs', 'echarts', 'highcharts'];

const CHART_RUNTIMES = {
	chartjs: [/^chart\.js$/, /^chartjs-/, /^react-chartjs-/],
	echarts: [/^echarts(-|$)/, /^zrender$/],
	highcharts: [/^highcharts(-|$)/, /^@highcharts\//]
};

const CORE = '@chartguard/core';
const CONFIG_CORE = '@chartguard/config-core';
const QUALITY_CORE = '@chartguard/quality-core';
const ANALYSIS = '@chartguard/analysis-typescript';
const CONFIG_ADAPTERS = LIBRARIES.map((library) => `@chartguard/config-${library}`);
const QUALITY_ADAPTERS = LIBRARIES.map((library) => `@chartguard/quality-${library}`);

/** Which chart library a package name belongs to, if it is a chart runtime or plugin. */
export function chartRuntimeOf(name) {
	return LIBRARIES.find((library) => CHART_RUNTIMES[library].some((pattern) => pattern.test(name)));
}

function rule({ internal = [], external = [], peer = [], node = false } = {}) {
	return { internal, external, peer, node };
}

function libraryRules(library) {
	return [
		[`@chartguard/config-${library}`, rule({ internal: [CORE, CONFIG_CORE] })],
		[`@chartguard/quality-${library}`, rule({ internal: [CORE, QUALITY_CORE] })],
		[
			`@chartguard/runtime-${library}`,
			rule({ internal: [CORE, `@chartguard/config-${library}`], peer: CHART_RUNTIMES[library] })
		]
	];
}

/**
 * The dependency law from the architecture docs. `external` and `peer` hold
 * exact names or patterns; `node` allows Node.js built-ins in source.
 * A workspace package missing from this table is itself a violation.
 */
export const POLICY = {
	[CORE]: rule(),
	[CONFIG_CORE]: rule({ internal: [CORE] }),
	[QUALITY_CORE]: rule({ internal: [CORE] }),
	[ANALYSIS]: rule({ internal: [CORE], external: ['typescript'] }),
	'@chartguard/eslint-plugin': rule({
		internal: [CORE, ...CONFIG_ADAPTERS, ...QUALITY_ADAPTERS, ANALYSIS],
		peer: ['eslint']
	}),
	'@chartguard/cli': rule({ internal: [CORE, ...CONFIG_ADAPTERS, ...QUALITY_ADAPTERS, ANALYSIS], node: true }),
	/** A browser app: published adapter entry points and the two runtimes it renders with; no Node built-ins. */
	'@chartguard/playground': rule({
		internal: [CORE, ...CONFIG_ADAPTERS, ...QUALITY_ADAPTERS],
		external: [...CHART_RUNTIMES.chartjs, ...CHART_RUNTIMES.echarts, 'date-fns']
	}),
	...Object.fromEntries(LIBRARIES.flatMap(libraryRules))
};

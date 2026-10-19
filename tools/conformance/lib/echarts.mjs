import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as echarts from 'echarts';

import { renderWith } from './echarts-render.mjs';
import { isJson } from './json.mjs';

const CORE_CHILD = fileURLToPath(new URL('echarts-core-child.mjs', import.meta.url));

/**
 * Renders an option with the pinned echarts runtime in server-side mode (SVG string, no DOM).
 * The full bundle registers every built-in component and series, matching the generated schema.
 * echarts logs each deprecation message once per process (`deprecateLog`), so in one run only the
 * first case using a deprecated option shows the runtime's warning; cases are written with distinct
 * deprecations, and corpus explanations say so where it matters.
 */
export function runEcharts(option) {
	return renderWith(echarts, option);
}

/**
 * Renders an option with `echarts/core` and only `modules` registered (`use([LineChart, GridComponent])`,
 * export names from `echarts/charts` and `echarts/components`). This process already holds the full
 * bundle, so the tree-shaken runtime runs in a child, with a development `NODE_ENV` like every
 * verdict. Returns the outcome and the registry context read back from that runtime.
 */
export function runEchartsModules(option, modules) {
	if (!isJson(option)) throw new Error('a tree-shaken case must be plain JSON');
	const input = JSON.stringify({ option, modules });
	const child = spawnSync(process.execPath, [CORE_CHILD, input], {
		encoding: 'utf8',
		timeout: 30_000,
		env: { ...process.env, NODE_ENV: 'development' }
	});
	if (child.status !== 0) throw new Error(`echarts/core child failed (${String(child.status)}): ${child.stderr}`);
	return JSON.parse(child.stdout);
}

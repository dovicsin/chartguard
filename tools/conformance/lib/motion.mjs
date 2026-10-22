import { copyPlain } from './copy.mjs';

/** What the pinned runtimes resolve for the motion of a chart (CG-05-04 part 7), for the conformance tests. */

/**
 * The animation options a dataset controller resolves (`_resolveAnimations`, dist/chart.js:978), from a
 * fresh `Config`: the harness draws on Chart.js's BasicPlatform, which turns animation off
 * (`config.options.animation = false`, :3244), and an animated chart would run its frames at once here.
 */
export function chartjsMotion(chart, user) {
	const Config = chart.config.constructor;
	const config = new Config(copyPlain(user));
	const datasets = config.data.datasets;
	if (datasets.length === 0) return undefined;
	const scopes = config.getOptionScopes(datasets[0], config.datasetAnimationScopeKeys(datasets[0].type ?? config.type, 'default'));
	const resolved = config.createResolver(scopes, {});
	if (resolved.animation === false) return { endless: false, longest: 0 };
	const entries = [resolved.animation, ...Object.keys(resolved.animations ?? {}).map((name) => resolved.animations[name])];
	return { endless: entries.some((entry) => entry.loop === true), longest: Math.max(0, ...entries.map((entry) => entry.duration ?? 0)) };
}

/** Whether any element of a rendered echarts chart has an animator that loops. */
function loops(chart) {
	let found = false;
	const visit = (element) => {
		found ||= element.animators?.some((animator) => animator._loop) === true;
		element.children?.().forEach(visit);
	};
	chart.getZr().storage.getRoots().forEach(visit);
	return found;
}

/** echarts: endless is a looping animator in the rendered chart; longest the resolved animation duration. */
export function echartsMotion(chart) {
	const model = chart.getModel();
	const durations = model.get('animation') === false ? [0] : [model.get('animationDuration'), ...model.getSeries().map((series) => series.get('animationDuration'))];
	return { endless: loops(chart), longest: Math.max(...durations) };
}

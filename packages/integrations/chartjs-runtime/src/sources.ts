/**
 * The Chart.js behaviour the guard rests on, each a pointer into the pinned chart.js checked by a test (E37):
 * - `initConfig` writes into the config's objects between `guard()` and `beforeInit` (`snapshot` in guard.ts);
 * - `allPlugins` runs the config's inline plugins (`config.plugins || []`), so the guard adds itself there;
 * - `options.plugins: false`, or `false` for one plugin's options, leaves every hook (or that plugin's) uncalled;
 * - a hook returning `false` cancels a cancelable step (`beforeUpdate`): how `block` stops a render;
 * - `Chart.version` is a static data property of the class, inherited by a subclass.
 */
export const SOURCES = [
	'chart.js@4.5.1 dist/chart.js:5356 config.data = initData(config.data);',
	'chart.js@4.5.1 dist/chart.js:5175 const local = config.plugins || [];',
	'chart.js@4.5.1 dist/chart.js:5158 return options === false && !all ? [] : createDescriptors(chart, plugins, options, all);',
	'chart.js@4.5.1 dist/chart.js:5189 if (!all && options === false) {',
	'chart.js@4.5.1 dist/chart.js:5134 if (callback(method, params, plugin) === false && args.cancelable) {',
	'chart.js@4.5.1 dist/chart.js:5638 static version = version;'
] as const;

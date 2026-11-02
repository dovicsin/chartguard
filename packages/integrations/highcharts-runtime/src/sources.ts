/**
 * The Highcharts behaviour the wrapper rests on, each a pointer into the pinned highcharts checked by a
 * test (E37). `Chart#update` matches each item of a collection (`planUpdate`, series.ts): skips a falsy
 * one, splats a single object, matches by `id` through `chart.get`, else by `index ?? i` unless that
 * series has another id or is internal, updates only an item of the same collection, and adds one only
 * with `oneToOne`. `Series#update` and `Chart#initSeries` give a series without its own type the
 * chart's; `initSeries` throws error #17 for a type `seriesTypes` lacks (`registriesOf`).
 */
export const SOURCES = [
	'highcharts@13.1.1 highcharts.src.js:40706 this.collectionsWithUpdate.forEach((coll) => {',
	'highcharts@13.1.1 highcharts.src.js:40708 splat(options[coll]).forEach((newOptions, i) => {',
	'highcharts@13.1.1 highcharts.src.js:40716 item = chart.get(newOptions.id);',
	'highcharts@13.1.1 highcharts.src.js:40720 item = chart[coll][(newOptions.index ?? i)];',
	'highcharts@13.1.1 highcharts.src.js:40724 if (item && ((hasId && defined(item.options.id)) ||',
	'highcharts@13.1.1 highcharts.src.js:40729 if (item && item.coll === coll) {',
	'highcharts@13.1.1 highcharts.src.js:40736 if (!item && oneToOne && chart.collectionsWithInit[coll]) {',
	'highcharts@13.1.1 highcharts.src.js:35811 let seriesOptions, n, keepProps = Series.keepProps.slice(), newType = (options.type ||',
	'highcharts@13.1.1 highcharts.src.js:38541 const chart = this, optionsChart = chart.options.chart, type = (options.type ||',
	'highcharts@13.1.1 highcharts.src.js:38545 error(17, true, chart, { missingModuleFor: type });'
] as const;

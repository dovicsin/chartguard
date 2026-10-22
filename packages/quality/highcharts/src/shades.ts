import { isContainer } from '@chartguard/core';
import { type Fact, isTransparent, type KnownFact, readFact, type Shades, unknown } from '@chartguard/quality-core';

type Scheme = 'light' | 'dark';

/** The palette colours (`defaultColors`), each at the line that defines it. */
const DEFAULT_COLORS: readonly KnownFact<string>[] = [
	{ value: '#2caffe', pointer: "highcharts@13.1.1 highcharts.src.js:12147 '#2caffe'," },
	{ value: '#544fc5', pointer: "highcharts@13.1.1 highcharts.src.js:12148 '#544fc5'," },
	{ value: '#00e272', pointer: "highcharts@13.1.1 highcharts.src.js:12149 '#00e272'," },
	{ value: '#fe6a35', pointer: "highcharts@13.1.1 highcharts.src.js:12150 '#fe6a35'," },
	{ value: '#6b8abc', pointer: "highcharts@13.1.1 highcharts.src.js:12151 '#6b8abc'," },
	{ value: '#d568fb', pointer: "highcharts@13.1.1 highcharts.src.js:12152 '#d568fb'," },
	{ value: '#2ee0ca', pointer: "highcharts@13.1.1 highcharts.src.js:12153 '#2ee0ca'," },
	{ value: '#fa4b42', pointer: "highcharts@13.1.1 highcharts.src.js:12154 '#fa4b42'," },
	{ value: '#feb56a', pointer: "highcharts@13.1.1 highcharts.src.js:12155 '#feb56a'," },
	{ value: '#91e8e1', pointer: "highcharts@13.1.1 highcharts.src.js:12156 '#91e8e1'" }
].map(({ value, pointer }) => ({ known: true, value, path: '$.palette.colors', source: 'default', pointer }));
/** Dark-scheme overrides of the palette colours (`defaultDarkOverrideColors`), by index. */
const DARK_OVERRIDES: Readonly<Record<number, KnownFact<string>>> = {
	1: {
		known: true,
		value: '#00e272',
		path: '$.palette.dark.colors',
		source: 'default',
		pointer: "highcharts@13.1.1 highcharts.src.js:12160 '#00e272',"
	},
	2: {
		known: true,
		value: '#efdf00',
		path: '$.palette.dark.colors',
		source: 'default',
		pointer: "highcharts@13.1.1 highcharts.src.js:12161 '#efdf00'"
	}
};
const BACKGROUNDS: Readonly<Record<Scheme, KnownFact<string>>> = {
	light: {
		known: true,
		value: '#ffffff',
		path: '$.palette.light.backgroundColor',
		source: 'default',
		pointer: "highcharts@13.1.1 highcharts.src.js:1691 backgroundColor: '#ffffff',"
	},
	dark: {
		known: true,
		value: '#141414',
		path: '$.palette.dark.backgroundColor',
		source: 'default',
		pointer: "highcharts@13.1.1 highcharts.src.js:1663 backgroundColor: '#141414',"
	}
};
const CHART_BACKGROUND =
	"highcharts@13.1.1 highcharts.src.js:1469 backgroundColor: 'var(--highcharts-background-color)',";

const isString = (value: unknown): value is string => typeof value === 'string';
const COLOR_VARIABLE = /^var\(--highcharts-color-(\d+)\)$/;
const BACKGROUND_VARIABLE = 'var(--highcharts-background-color)';

/**
 * The palette colour `index` in `scheme`, as the injected CSS defines `--highcharts-color-<index>`
 * (highcharts.src.js:12262): the scheme's `colors`, else the palette's, else (dark) the dark default,
 * else the default. Undefined when a palette entry cannot be read.
 */
function paletteColor(config: unknown, scheme: Scheme, index: number): Fact<string> {
	const scoped = [
		['palette', scheme, 'colors', index],
		['palette', 'colors', index]
	].map((path) => readFact(config, path, isString));
	const decided = scoped.find((fact) => fact.known || (fact.reason !== 'unset' && fact.reason !== 'shape'));
	if (decided !== undefined) return decided;
	const fallback = (scheme === 'dark' ? DARK_OVERRIDES[index] : undefined) ?? DEFAULT_COLORS[index];
	return fallback ?? unknown(`$.palette.colors[${String(index)}]`, 'unmodelled');
}

/** The background in `scheme`: the scheme's palette `backgroundColor`, else the default. */
function paletteBackground(config: unknown, scheme: Scheme): Fact<string> {
	const own = readFact(config, ['palette', scheme, 'backgroundColor'], isString);
	return own.known || own.reason !== 'unset' ? own : BACKGROUNDS[scheme];
}

/** What a colour stands for in `scheme`: a palette variable's value, or the colour itself. */
function resolved(config: unknown, color: KnownFact<string>, scheme: Scheme): Fact<string> {
	const variable = COLOR_VARIABLE.exec(color.value);
	if (variable !== null) return paletteColor(config, scheme, Number(variable[1]));
	return color.value === BACKGROUND_VARIABLE ? paletteBackground(config, scheme) : color;
}

/** A colour as shown in `scheme`, or undefined when it is not known (an unread entry, another CSS variable). */
function shade(config: unknown, color: KnownFact<string>, scheme: Scheme): KnownFact<string> | undefined {
	const value = resolved(config, color, scheme);
	return value.known && !value.value.startsWith('var(') ? value : undefined;
}

/**
 * The schemes the chart can be shown in: both by default (the injected CSS gives the container
 * `color-scheme: light dark`, following the user). A `palette.colorScheme` of its own, or CSS the page
 * injects (`injectCSS: false`), is not modelled.
 */
function schemes(config: unknown): readonly Scheme[] | undefined {
	const palette = readFact(config, ['palette'], isContainer);
	if (!palette.known) return palette.reason === 'unset' ? ['light', 'dark'] : undefined;
	const [scheme, inject] = [
		readFact(config, ['palette', 'colorScheme'], isString),
		readFact(config, ['palette', 'injectCSS'], (value): value is boolean => typeof value === 'boolean')
	];
	if (scheme.known || scheme.reason !== 'unset' || (inject.known ? !inject.value : inject.reason !== 'unset'))
		return undefined;
	return ['light', 'dark'];
}

/** A colour as shown in each scheme the chart can be shown in. */
export function shadesOf(config: unknown, color: Fact<string>): Fact<Shades> {
	if (!color.known) return color;
	const shown = schemes(config);
	if (shown === undefined) return unknown(color.path, 'unmodelled');
	const [light, dark] = (['light', 'dark'] as const).map((scheme) =>
		shown.includes(scheme) ? shade(config, color, scheme) : undefined
	);
	return light === undefined && dark === undefined
		? unknown(color.path, 'unmodelled')
		: { ...color, value: { light, dark } };
}

/**
 * The background series are drawn on: the plot background when it has a colour, else the chart's (a
 * palette variable by default). Transparent ones draw nothing: with both, the page shows through (`page`).
 */
export function backgroundOf(config: unknown): Fact<Shades> {
	// An SVG fill of `none` draws nothing either.
	const drawsNothing = (color: string): boolean => isTransparent(color) || color.trim().toLowerCase() === 'none';
	const plot = readFact(config, ['chart', 'plotBackgroundColor'], isString);
	if (plot.known && !drawsNothing(plot.value)) return shadesOf(config, plot);
	if (!plot.known && plot.reason !== 'unset') return plot;
	const chart = readFact(config, ['chart', 'backgroundColor'], isString, {
		value: BACKGROUND_VARIABLE,
		pointer: CHART_BACKGROUND
	});
	return chart.known && drawsNothing(chart.value) ? unknown(chart.path, 'page') : shadesOf(config, chart);
}

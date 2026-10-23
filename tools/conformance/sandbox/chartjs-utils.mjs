/**
 * Deterministic stand-in for the Chart.js docs `Utils` helper (docs/scripts/utils.js at v4.5.1,
 * MIT): the same functions and constants the samples call, with a fixed seed and a fixed base
 * date instead of `Date.now()`, and without the luxon / @kurkle/color dependencies.
 */
const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];
const COLORS = ['#4dc9f6', '#f67019', '#f53794', '#537bc4', '#acc236', '#166a8f', '#00a950', '#58595b', '#8549ba'];
const CHART_COLORS = {
	red: 'rgb(255, 99, 132)',
	orange: 'rgb(255, 159, 64)',
	yellow: 'rgb(255, 205, 86)',
	green: 'rgb(75, 192, 192)',
	blue: 'rgb(54, 162, 235)',
	purple: 'rgb(153, 102, 255)',
	grey: 'rgb(201, 203, 207)'
};
const NAMED_COLORS = Object.values(CHART_COLORS);
const BASE_DATE = Date.UTC(2024, 0, 1);
const DAY = 86_400_000;

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` → `[r, g, b]`. */
function channels(color) {
	const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
	if (rgb !== null) return rgb.slice(1, 4).map(Number);
	const hex = color.replace('#', '');
	const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
	return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));
}

/** The seeded generator of the docs helper: `rand(min, max)` plus `srand(seed)`. */
function seededRandom(seed) {
	let state = seed;
	return {
		srand: (next) => {
			state = next;
		},
		rand: (min = 0, max = 0) => {
			state = (state * 9301 + 49297) % 233_280;
			return min + (state / 233_280) * (max - min);
		}
	};
}

/** `numbers`, `points`, `bubbles` and `labels`, built on a seeded `rand`. */
function dataHelpers(rand) {
	const numbers = ({ count = 8, min = 0, max = 100, from = [], decimals = 8, continuity = 1 } = {}) => {
		const factor = 10 ** decimals;
		return Array.from({ length: count }, (_, index) => {
			const value = (from[index] ?? 0) + rand(min, max);
			return rand() <= continuity ? Math.round(factor * value) / factor : null;
		});
	};
	const points = (config) => {
		const ys = numbers(config);
		return numbers(config).map((x, index) => ({ x, y: ys[index] }));
	};
	const labels = ({ min = 0, max = 100, count = 8, decimals = 8, prefix = '' } = {}) => {
		const step = (max - min) / count;
		const factor = 10 ** decimals;
		const values = [];
		for (let value = min; value < max; value += step) values.push(prefix + String(Math.round(factor * value) / factor));
		return values;
	};
	const bubbles = (config) => points(config).map((point) => ({ ...point, r: rand(config.rmin, config.rmax) }));
	return { numbers, points, bubbles, labels };
}

const transparentize = (value, opacity) => {
	const alpha = opacity === undefined ? 0.5 : 1 - opacity;
	return `rgba(${channels(value).join(', ')}, ${String(alpha)})`;
};

/** luxon `DateTime` in the original; the samples only call `toMillis()` on it. */
const parseISODate = (text) => {
	const date = new Date(text);
	return { toMillis: () => date.getTime(), toJSDate: () => date };
};

export function createUtils(seed = 42) {
	const random = seededRandom(seed);
	return {
		CHART_COLORS,
		...random,
		...dataHelpers(random.rand),
		months: ({ count = 12, section } = {}) =>
			Array.from({ length: count }, (_, index) => MONTHS[index % 12].substring(0, section)),
		color: (index) => COLORS[index % COLORS.length],
		namedColor: (index) => NAMED_COLORS[index % NAMED_COLORS.length],
		transparentize,
		newDate: (days) => new Date(BASE_DATE + days * DAY),
		newDateString: (days) => new Date(BASE_DATE + days * DAY).toISOString(),
		parseISODate
	};
}

import type { ChartSemantics, Shades } from './chart.js';
import { type Fact, type KnownFact, unknown } from './facts.js';
import type { CheckedBackground, Settings } from './settings.js';

/** What the caller declares, for a fact the chart leaves to the page: at the path where the chart leaves it. */
const declared = <T>(value: T, path: string): KnownFact<T> => ({ known: true, value, path, source: 'context' });

/** The page background in each scheme the caller names; a scheme left out is not shown (not compared). */
function pageBackground(background: CheckedBackground, path: string): Fact<Shades> {
	const shade = (color: string | undefined): KnownFact<string> | undefined =>
		color === undefined ? undefined : declared(color, path);
	const [light, dark] = [shade(background.light), shade(background.dark)];
	return light === undefined && dark === undefined ? unknown(path, 'page') : declared({ light, dark }, path);
}

/**
 * The chart with the facts it leaves to the page (`page`) filled from the context the caller declares
 * (CG-05-05): its background, and whether its data is described. Facts the config decides are never
 * replaced.
 */
export function withContext(chart: ChartSemantics, context: Settings['context']): ChartSemantics {
	const { background, access } = chart;
	const leftToPage = (fact: Fact<unknown>): boolean => !fact.known && fact.reason === 'page';
	return {
		...chart,
		background:
			leftToPage(background) && context.background !== undefined
				? pageBackground(context.background, background.path)
				: background,
		access:
			leftToPage(access.dataDescribed) && context.describesData !== undefined
				? { ...access, dataDescribed: declared(context.describesData, access.dataDescribed.path) }
				: access
	};
}

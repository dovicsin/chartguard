import { runtimePointer } from './runtime.mjs';

/**
 * What the Highcharts declarations leave narrower than the runtime, found by running the official
 * demos (CG-01-05 part 4) and read from the pinned runtime code, each fact citing its line:
 *
 * - options are read with `pick()`, which skips `null` like `undefined`: a `null` optional option
 *   is unset (`chart.plotBackgroundColor: null`, `yAxis.title.text: null` in the demos);
 * - `dashstyleSetter` lower-cases the value and turns words and comma lists into a dash array;
 * - category labels are `categories[pos] ?? names[pos] ?? pos`: numbers label as well as strings;
 * - `optionsToObject` maps a number, `null` or any array to a point by the series' `keys` or
 *   `pointArrayMap`, whatever tuples the declarations list; `getX` parses a string `x` as a date,
 *   and x-range points parse `x2` the same way and take `partialFill` as a bare amount;
 * - radial axes take `labels.rotation: 'auto'`; organization charts, like every sankey-based
 *   series, take `nodeWidth: 'auto'`; `time.useUTC` is a boolean, as its own documentation says;
 * - `dataMapping` keys are point properties (the declaration is an empty interface that says so);
 * - a text's `style.width` is read with `pInt`, so a CSS length (`'90px'`) is a width as well as a number;
 * - `plotOptions.series` is merged into every series, so it takes the options of every series type.
 */
const FACTS = {
	pick: { file: 'highcharts.src.js', pattern: "if (typeof arg !== 'undefined' && arg !== null) {" },
	dashStyle: { file: 'highcharts.src.js', pattern: 'value = value.toLowerCase();' },
	categories: { file: 'highcharts.src.js', pattern: '(categories[pos] ?? names[pos] ?? pos) :' },
	points: { file: 'highcharts.src.js', pattern: 'pointArrayMap = keys || series.pointArrayMap' },
	pointX: { file: 'highcharts.src.js', pattern: '// If x is a string, try to parse it to a datetime' },
	pointX2: { file: 'modules/xrange.src.js', pattern: 'this.x2 = this.series.chart.time.parse(this.x2);' },
	partialFill: { file: 'modules/xrange.src.js', pattern: 'partialFill = point.partialFill ?? 0;' },
	rotation: { file: 'highcharts-more.src.js', pattern: "if (labelOptions.rotation === 'auto') {" },
	nodeWidth: { file: 'modules/sankey.src.js', pattern: "if (nodeWidth === 'auto') {" },
	useUTC: { file: 'highcharts.d.ts', pattern: 'Setting `useUTC` to true is equivalent to setting `time.timezone` to' },
	dataMapping: { file: 'highcharts.d.ts', pattern: 'export interface DataMappingOptionsObject {}' },
	plotSeries: { file: 'highcharts.src.js', pattern: 'const options = merge(typeOptions, plotOptions.series,' },
	cssWidth: { file: 'highcharts.src.js', pattern: 'textWidth = this.textWidth = pInt(styles.width);' }
};

const ANY_ARRAY = { kind: 'array', items: { kind: 'unknown' } };
const changed = (what) => new Error(`highcharts types changed: ${what}`);
const sameNode = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** The provenance with one more runtime source; a node without provenance gets the runtime fact as its own. */
const withSource = (provenance, source) =>
	provenance === undefined
		? { confidence: 'authoritative', sources: [source] }
		: { ...provenance, sources: [...provenance.sources, source] };

/** `node` also accepting `extra` members it does not have yet. */
function widened(node, extra) {
	const members = node.kind === 'union' ? node.anyOf : [node];
	const added = extra.filter((member) => !members.some((known) => sameNode(known, member)));
	return added.length === 0 ? node : { kind: 'union', anyOf: [...members, ...added] };
}

/** A step: the `key` property of the definitions `owners` names, transformed and citing the fact. */
function property(owners, key, transform) {
	return (definitions, source) => {
		const changes = owners(definitions).flatMap((name) => {
			const definition = definitions[name];
			const known = definition?.properties?.[key];
			if (known === undefined) throw changed(`${name}.${key}`);
			const next = { ...known, node: transform(known.node), provenance: withSource(known.provenance, source) };
			return [[name, { ...definition, properties: { ...definition.properties, [key]: next } }]];
		});
		return { ...definitions, ...Object.fromEntries(changes) };
	};
}

/** Object definitions with a `key` property whose definition name and node pass `test`. */
const objectsWith =
	(key, test = () => true) =>
	(definitions) =>
		Object.keys(definitions).filter((name) => {
			const known = definitions[name].kind === 'object' ? definitions[name].properties[key] : undefined;
			return known !== undefined && test(name, known.node);
		});

/** Every object definition: a null optional option is unset. */
function nullAsAbsent(definitions, source) {
	const entries = Object.entries(definitions).map(([name, node]) =>
		node.kind === 'object'
			? [name, { ...node, nullAsAbsent: true, provenance: withSource(node.provenance, source) }]
			: [name, node]
	);
	return Object.fromEntries(entries);
}

/** A list of points: a number, `null` and any array are points too; object members stay as declared. */
function points(node) {
	if (node.kind !== 'array') return node;
	const members = node.items.kind === 'union' ? node.items.anyOf : [node.items];
	const declared = members.filter((member) => member.kind !== 'array');
	return {
		kind: 'array',
		items: widened({ kind: 'union', anyOf: declared }, [{ kind: 'number' }, { kind: 'null' }, ANY_ARRAY])
	};
}

const categories = (node) =>
	node.kind === 'array' ? { kind: 'array', items: widened(node.items, [{ kind: 'number' }]) } : node;

function dashStyle(definitions, source) {
	const union = definitions.DashStyleValue;
	if (union?.kind !== 'union' || !union.anyOf.every((member) => member.kind === 'literal'))
		throw changed('DashStyleValue');
	return { ...definitions, DashStyleValue: { kind: 'string', provenance: withSource(union.provenance, source) } };
}

function dataMapping(definitions, source) {
	const mapping = definitions.DataMappingOptionsObject;
	if (mapping?.kind !== 'object' || Object.keys(mapping.properties).length > 0)
		throw changed('DataMappingOptionsObject');
	return {
		...definitions,
		DataMappingOptionsObject: { ...mapping, additional: 'open', provenance: withSource(mapping.provenance, source) }
	};
}

/** `plotOptions.series`: its own options, then every option of every series type, a name taking each distinct type. */
function anySeriesOptions(definitions, plotOptions, source) {
	const own = definitions[plotOptions.properties.series.node.ref];
	const collected = new Map(
		Object.entries(own.properties).map(([key, known]) => [key, { known, nodes: [known.node] }])
	);
	for (const [key, entry] of Object.entries(plotOptions.properties)) {
		const options = key === 'series' || entry.node.kind !== 'ref' ? undefined : definitions[entry.node.ref];
		for (const [name, known] of Object.entries(options?.properties ?? {})) {
			const found = collected.get(name) ?? { known, nodes: [] };
			if (!found.nodes.some((node) => sameNode(node, known.node))) found.nodes.push(known.node);
			collected.set(name, found);
		}
	}
	const properties = [...collected].map(([name, { known, nodes }]) => [
		name,
		{
			...known,
			node: nodes.length === 1 ? nodes[0] : { kind: 'union', anyOf: nodes },
			provenance: withSource(known.provenance, source)
		}
	]);
	return { ...own, properties: Object.fromEntries(properties) };
}

/** `plotOptions.series` pointing at the merged options of every series type. */
function anySeries(definitions, optionName, source) {
	const name = definitions[optionName].properties.plotOptions.node.ref;
	const plotOptions = definitions[name];
	const series = { ...plotOptions.properties.series, node: { kind: 'ref', ref: 'AnySeriesPlotOptions' } };
	return {
		...definitions,
		AnySeriesPlotOptions: anySeriesOptions(definitions, plotOptions, source),
		[name]: { ...plotOptions, properties: { ...plotOptions.properties, series } }
	};
}

/** A step: the `key` property of the definitions `owners` names also accepts `extra`. */
const alsoAccepts = (owners, key, ...extra) => property(owners, key, (node) => widened(node, extra));
const named =
	(...names) =>
	() =>
		names;
const STRING = { kind: 'string' };

/** The facts in the order they apply; later steps see what earlier ones produced. */
function steps({ optionName, seriesVariants }) {
	const isPointX = (name, node) => name.endsWith('PointOptionsObject') && node.kind === 'number';
	// Indicator series (`abands`, …) take their data from `linkedTo` and declare none.
	const withData = (defs) => seriesVariants.filter((name) => defs[name].properties.data !== undefined);
	return [
		['pick', nullAsAbsent],
		[
			'categories',
			property(
				objectsWith('categories', (_, node) => node.kind === 'array'),
				'categories',
				categories
			)
		],
		['points', property(withData, 'data', points)],
		['pointX', alsoAccepts(objectsWith('x', isPointX), 'x', STRING)],
		['pointX2', alsoAccepts(named('XrangePointOptionsObject'), 'x2', STRING)],
		['partialFill', alsoAccepts(named('XrangePointOptionsObject'), 'partialFill', { kind: 'number' })],
		[
			'rotation',
			alsoAccepts(named('XAxisLabelsOptions', 'YAxisLabelsOptions'), 'rotation', { kind: 'literal', value: 'auto' })
		],
		['nodeWidth', alsoAccepts(objectsWith('nodeWidth'), 'nodeWidth', STRING)],
		['useUTC', alsoAccepts((defs) => [defs[optionName].properties.time.node.ref], 'useUTC', { kind: 'boolean' })],
		['dashStyle', dashStyle],
		['dataMapping', dataMapping],
		['cssWidth', alsoAccepts(named('CSSObject'), 'width', STRING)],
		['plotSeries', (defs, source) => anySeries(defs, optionName, source)]
	];
}

/** New definitions with the runtime facts above applied, one step after the other, each citing its line. */
export function withHighchartsRuntimeFacts(root, definitions, shape) {
	const cite = (fact) => ({ source: 'highcharts', pointer: runtimePointer(root, 'highcharts', FACTS[fact]) });
	return steps(shape).reduce((defs, [fact, step]) => step(defs, cite(fact)), definitions);
}

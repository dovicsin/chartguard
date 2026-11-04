import { runtimePointer } from './runtime.mjs';

/**
 * What Chart.js does with an option of another type than the declarations say (A73), read from the
 * line each fact cites. `_checkEventBindings` compares `responsive` with `!==` to whether resize
 * listeners are bound (a boolean): any other value never matches, so every update unbinds and binds
 * every listener again, and a truthy one binds the resize listeners, which runs the resize step.
 */
const EFFECTS = {
	responsive: {
		fact: { file: 'dist/chart.js', pattern: '!!this._responsiveListeners !== options.responsive' },
		effect:
			'Chart.js compares responsive with !== to whether it listens for resizes (a boolean), so any other value makes every update unbind and bind all its event listeners again; a truthy one also runs its resize step each time, which can recurse when the container size follows the chart.'
	}
};

/**
 * The chart options of every configuration (`config.options`) with the effect of a mismatched value
 * on each option `EFFECTS` names, its runtime line added to the option's provenance.
 */
export function withMismatchEffects(root, definitions, configNames) {
	const next = { ...definitions };
	const optionsNames = new Set(configNames.map((name) => definitions[name].properties.options.node.ref));
	for (const name of optionsNames) {
		const properties = { ...next[name].properties };
		for (const [key, { fact, effect }] of Object.entries(EFFECTS)) {
			const property = properties[key];
			if (property === undefined) throw new Error(`chart.js types changed: ${name} has no option "${key}"`);
			const source = { source: 'chartjs', pointer: runtimePointer(root, 'chart.js', fact) };
			const provenance = { ...property.provenance, sources: [...property.provenance.sources, source] };
			properties[key] = { ...property, provenance, onMismatch: effect };
		}
		next[name] = { ...next[name], properties };
	}
	return next;
}

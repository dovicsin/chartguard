/**
 * Why a fact is not known. `unset`: the config does not set it and its runtime default is not
 * modelled; `accessor`: it sits behind a getter, which is never run; `dynamic`: a function decides it
 * at runtime; `shape`: the config holds a value of a shape this fact does not read; `unmodelled`: the
 * runtime decides it in a way not modelled yet; `inapplicable`: the chart has no such thing (a pie
 * series has no value axis); `layout`: it depends on the size the chart is drawn at; `page`: the chart
 * leaves it to the page it is shown in (a transparent background, a canvas's text alternative), which
 * the caller can declare (`QualityContext`).
 */
export type UnknownReason =
	'unset' | 'accessor' | 'dynamic' | 'shape' | 'unmodelled' | 'inapplicable' | 'layout' | 'page';

/**
 * A fact read from the config, the runtime's default for it with a pointer into the pinned package,
 * or (`context`) what the caller declares about the page for a fact the chart leaves to it; its path is
 * where the chart leaves it.
 */
export type KnownFact<T> =
	| { readonly known: true; readonly value: T; readonly path: string; readonly source: 'config' | 'context' }
	| {
			readonly known: true;
			readonly value: T;
			readonly path: string;
			readonly source: 'default';
			readonly pointer: string;
	  };

/** A fact that is not known, where it would be read from, and why. */
export interface UnknownFact {
	readonly known: false;
	readonly path: string;
	readonly reason: UnknownReason;
}

/** A library-neutral fact about a chart: known (with the path it was read from) or unknown (with why). */
export type Fact<T> = KnownFact<T> | UnknownFact;

/** A runtime default: the value the library uses when the config does not set it, and where it says so. */
export interface Default<T> {
	readonly value: T;
	/** `<package>@<version> <file>: <text on that line>`; tests check the text is in the pinned file. */
	readonly pointer: string;
}

/** A list read from the config (series, axes): its items, or why the list is not known. */
export type Listed<T> = { readonly known: true; readonly path: string; readonly items: readonly T[] } | UnknownFact;

export const known = <T>(value: T, path: string): KnownFact<T> => ({ known: true, value, path, source: 'config' });

export const defaulted = <T>({ value, pointer }: Default<T>, path: string): KnownFact<T> => ({
	known: true,
	value,
	path,
	source: 'default',
	pointer
});

export const unknown = (path: string, reason: UnknownReason): UnknownFact => ({ known: false, path, reason });

/** The value of a known fact, or undefined: for rules, which claim nothing on an unknown fact. */
export const valueOf = <T>(fact: Fact<T>): T | undefined => (fact.known ? fact.value : undefined);

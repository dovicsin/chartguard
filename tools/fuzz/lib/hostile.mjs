import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Hostile configs for fuzzing (CG-07-02): the libraries' own known-valid and contract configs, each
 * changed at a random place into a value a careless or hostile caller may hand over. Seeded, so a
 * failure is reproduced from its seed; accessors count their calls, so a test can prove none ran.
 */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** A small deterministic PRNG (mulberry32): `next()` is in [0, 1). */
export function random(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const pick = (next, list) => list[Math.floor(next() * list.length)];

/** Every config a library's fixtures hold (known-valid and every contract table), as written there. */
export async function corpus(library) {
	const directory = join(ROOT, 'packages', 'config', library, 'tests', 'fixtures');
	const configs = [];
	for (const file of readdirSync(directory).sort()) {
		const module = await import(pathToFileURL(join(directory, file)).href);
		for (const value of Object.values(module)) {
			if (Array.isArray(value))
				configs.push(...value.filter((entry) => entry?.config !== undefined).map((entry) => entry.config));
			else if (value !== null && typeof value === 'object') configs.push(...Object.values(value));
		}
	}
	return configs;
}

/** Counts every accessor of a hostile value that runs: a validator or review must never run one. */
export const accessorCalls = { count: 0 };

function counted(value) {
	return () => {
		accessorCalls.count += 1;
		return value;
	};
}

function nested(depth, leaf) {
	let value = leaf;
	for (let level = 0; level < depth; level++) value = level % 2 === 0 ? { a: value } : [value];
	return value;
}

/** The hostile values a place in a config may be replaced with, by name. */
const HOSTILE = {
	deepObjects: () => nested(20_000, 1),
	deepArrays: () => nested(5_000, 'x'),
	cycle: () => {
		const a = { b: {} };
		a.b.a = a;
		return a;
	},
	wide: () => Object.fromEntries(Array.from({ length: 30_000 }, (_, index) => [`k${String(index)}`, index])),
	long: () => Array.from({ length: 60_000 }, (_, index) => index),
	sparse: () => {
		const list = [1];
		list[50_000] = 2;
		return list;
	},
	nullPrototype: () => Object.assign(Object.create(null), { type: 'bar', data: 1 }),
	protoKey: () => JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}'),
	symbolKey: () => ({ [Symbol('s')]: 1, a: 1 }),
	getter: () => Object.defineProperty({}, 'type', { enumerable: true, get: counted('bar') }),
	throwingGetter: () =>
		Object.defineProperty({}, 'data', {
			enumerable: true,
			get: () => {
				accessorCalls.count += 1;
				throw new Error('a getter ran');
			}
		}),
	typedArray: () => new Float64Array([1, 2, Number.NaN]),
	date: () => new Date(0),
	map: () => new Map([['a', 1]]),
	set: () => new Set([1]),
	instance: () =>
		new (class Point {
			x = 1;
		})(),
	fn: () => () => 1,
	numbers: () => [Number.NaN, Infinity, -Infinity, -0, Number.MAX_VALUE, Number.MIN_VALUE],
	bigint: () => 10n,
	symbol: () => Symbol('v'),
	longString: () => 'x'.repeat(1_000_000),
	nulls: () => [null, undefined, null],
	empty: () => ({})
};
const HOSTILE_KINDS = Object.keys(HOSTILE);

/**
 * A copy of a plain config down to a depth (deeper parts and other values shared as they are), so
 * each case starts from a fresh corpus config.
 */
function copy(value, fresh, depth = 0) {
	if (value === null || typeof value !== 'object' || depth > PLACE_DEPTH) return value;
	const isPlain = Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value));
	if (!isPlain) return value;
	const out = Array.isArray(value) ? [] : {};
	fresh.add(out);
	for (const key of Object.keys(value)) out[key] = copy(value[key], fresh, depth + 1);
	return out;
}

/** The containers of a config a case may change: the root first, down to a depth (a fixture may nest deeply). */
const PLACE_DEPTH = 40;

function containers(root, fresh) {
	const found = [];
	const seen = new Set();
	const pending = [{ container: root, path: [] }];
	while (pending.length > 0) {
		const { container, path } = pending.shift();
		if (container === null || typeof container !== 'object' || seen.has(container)) continue;
		seen.add(container);
		// Only what `copy` made is changed or walked: a shared corpus part is never touched.
		if (!fresh.has(container)) continue;
		found.push({ container, path });
		if (path.length < PLACE_DEPTH)
			for (const key of Object.keys(container)) pending.push({ container: container[key], path: [...path, key] });
	}
	return found;
}

/**
 * Freezes every object reachable through own data properties (iteratively: a hostile value nests
 * deeper than the stack): a write by the code under test then throws.
 */
export function deepFreeze(root) {
	const seen = new Set();
	const pending = [root];
	while (pending.length > 0) {
		const value = pending.pop();
		if (value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) continue;
		seen.add(value);
		if (ArrayBuffer.isView(value)) continue;
		for (const key of Reflect.ownKeys(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor !== undefined && 'value' in descriptor) pending.push(descriptor.value);
		}
		Object.freeze(value);
	}
	return root;
}

/**
 * One fuzz case: a corpus config with a hostile value at a random place (or as the whole config), and
 * how it was made, for the failure message.
 */
export function hostileCase(configs, next) {
	const fresh = new WeakSet();
	const base = copy(pick(next, configs), fresh);
	const kind = pick(next, HOSTILE_KINDS);
	const value = HOSTILE[kind]();
	const places = containers(base, fresh);
	if (next() < 0.1 || places.length === 0) return { config: value, kind, at: '$' };
	const { container, path } = pick(next, places);
	const keys = Object.keys(container);
	const added = Array.isArray(container) ? container.length : 'extra';
	const key = keys.length > 0 && next() < 0.7 ? pick(next, keys) : added;
	container[key] = value;
	return { config: base, kind, at: ['$', ...path, key].join('.') };
}

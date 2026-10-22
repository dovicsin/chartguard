import type { Fix, KeyRename, OptionEdit } from './diagnostic.js';
import { isContainer } from './object.js';
import { pathSegments } from './paths.js';

/** A fix that cannot be applied to this config: the option changed since the finding, or the path cannot be edited. */
export class FixError extends Error {
	override readonly name = 'FixError';
}

type Segment = string | number;

/**
 * A shallow copy that keeps the prototype and every property: getters are copied, never run. The copy
 * is ours, so its properties are configurable (a frozen input stays frozen; its copy can be edited).
 */
function copyOf(value: object): object {
	const array = Array.isArray(value);
	const shell: object = array ? [] : (Object.create(Object.getPrototypeOf(value) as object | null) as object);
	const descriptors: PropertyDescriptorMap = {};
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		if (array && key === 'length') continue;
		descriptors[key] =
			'value' in descriptor
				? { ...descriptor, writable: true, configurable: true }
				: { ...descriptor, configurable: true };
	}
	Object.defineProperties(shell, descriptors);
	if (array) (shell as unknown[]).length = value.length;
	return shell;
}

/** The own data value at `key`, `absent`, or a refusal for a getter (never run). */
function own(target: object, key: Segment, path: string): { readonly value: unknown } | 'absent' {
	const descriptor = Object.getOwnPropertyDescriptor(target, String(key));
	if (descriptor === undefined) return 'absent';
	if (!('value' in descriptor)) throw new FixError(`${path}: a getter is on the way; it is never run`);
	return { value: descriptor.value as unknown };
}

function define(target: object, key: Segment, value: unknown): void {
	Object.defineProperty(target, String(key), { value, writable: true, enumerable: true, configurable: true });
}

/**
 * The config with `edit(parent, key)` applied to the object holding the last segment of `path`, every
 * object on the way copied and everything else shared: the input is never written. Missing objects
 * on the way are created for keys, never for array indices.
 */
function edited(config: unknown, path: string, edit: (parent: object, key: Segment) => void): unknown {
	const segments = pathSegments(path);
	if (segments === undefined || segments.length === 0) throw new FixError(`${path}: not a path to an option`);
	const descend = (value: unknown, index: number): object => {
		if (!isContainer(value)) throw new FixError(`${path}: ${typeof value} on the way, not an object`);
		const key = segments[index];
		if (key === undefined) throw new FixError(`${path}: not a path to an option`);
		const copy = copyOf(value);
		if (index === segments.length - 1) {
			edit(copy, key);
			return copy;
		}
		const next = own(value, key, path);
		if (next === 'absent' && typeof key === 'number') throw new FixError(`${path}: no element ${String(key)}`);
		define(copy, key, descend(next === 'absent' ? {} : next.value, index + 1));
		return copy;
	};
	return descend(config, 0);
}

function setOption(config: unknown, { path, from, value }: OptionEdit, hadFrom: boolean): unknown {
	return edited(config, path, (parent, key) => {
		const current = own(parent, key, path);
		const holds = hadFrom ? current !== 'absent' && Object.is(current.value, from) : current === 'absent';
		if (!holds) throw new FixError(`${path}: the option is no longer ${hadFrom ? JSON.stringify(from) : 'unset'}`);
		define(parent, key, value);
	});
}

function renameKey(config: unknown, path: string, { to }: KeyRename): unknown {
	return edited(config, path, (parent, key) => {
		const current = own(parent, key, path);
		if (current === 'absent' || current.value === null) throw new FixError(`${path}: nothing to rename`);
		const target = own(parent, to, path);
		if (target !== 'absent' && target.value !== undefined) throw new FixError(`${path}: ${to} is already set`);
		Reflect.deleteProperty(parent, String(key));
		define(parent, to, current.value);
	});
}

/**
 * The config with `fix` applied (`path`: the finding's, for a rename): a new object, the input never
 * written and no getter run. Throws `FixError` when it no longer applies: a `set-option` whose option
 * is not `from` any more, a rename whose key is gone or whose new name is taken, a path through a
 * getter, a primitive or a missing array element.
 */
export function applyFix(config: unknown, fix: Fix, path?: string): unknown {
	if (fix.kind === 'set-option') return setOption(config, fix, Object.hasOwn(fix, 'from'));
	if (path === undefined) throw new FixError('a rename needs the path of the key it renames');
	return renameKey(config, path, fix);
}

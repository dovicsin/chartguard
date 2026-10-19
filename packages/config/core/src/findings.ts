import { type Coverage, type Diagnostic, suggestion } from '@chartguard/core';

import { confirmed, inconclusive, unresolved } from './diagnostics.js';
import { kindOf } from './kind.js';
import { keySegment } from './paths.js';
import type { Handler, NodeSchema } from './schema.js';
import type { Selection } from './union.js';

/** The findings the walker reports, built apart from the walk so each reads as one decision. */

/** An option for a component or plugin the runtime does not have: rejected, or ignored. */
export function unhandledFinding({ name, enforced }: Handler, path: string): Diagnostic {
	if (enforced)
		return {
			...confirmed(
				'CFG_UNREGISTERED',
				path,
				`"${name}" is not registered with the runtime, which rejects this option.`
			),
			suggestion: `Register ${name}.`
		};
	return {
		code: 'CFG_INEFFECTIVE',
		severity: 'warning',
		confidence: 'certain',
		path,
		message: `"${name}" is not registered, so the runtime ignores this option.`,
		suggestion: `Register ${name}, or remove the option.`
	};
}

export function registrationFinding(
	selection: Extract<Selection, { kind: 'registered' | 'unregistered' }>,
	path: string
): Diagnostic {
	const { key, value } = selection;
	const keyPath = `${path}${keySegment(key)}`;
	if (selection.kind === 'registered')
		return inconclusive(
			'CFG_REGISTERED_VARIANT',
			keyPath,
			`"${value}" is registered by an extension; its options are not checked.`
		);
	const { name, siblings } = selection.registration;
	// The registry name, when it differs from the value (`dataZoom.slider` for `slider`).
	const as = name === value ? '' : ` (${name})`;
	const message = selection.defaulted
		? `No ${key} given: the runtime picks "${value}"${as}, which is not registered, so it rejects it.`
		: `"${value}" is not registered with the runtime${as}, which rejects it.`;
	const hint =
		siblings.length === 0 ? `Register ${name}.` : `Register ${name}, or use a registered one: ${siblings.join(', ')}.`;
	return { ...confirmed('CFG_UNREGISTERED', selection.defaulted ? path : keyPath, message), suggestion: hint };
}

export function variantFinding(
	selection: Extract<Selection, { kind: 'unknown-variant' | 'invalid-variant' }>,
	path: string
): Diagnostic {
	const keyPath = `${path}${keySegment(selection.key)}`;
	const known = selection.known.map(String);
	if (selection.kind === 'invalid-variant')
		return confirmed('CFG_ENUM', keyPath, `Value must be one of: ${known.join(', ')}.`);
	const value = typeof selection.value === 'string' ? selection.value : kindOf(selection.value);
	const match = typeof selection.value === 'string' ? suggestion(selection.value, known) : undefined;
	return {
		...unresolved('CFG_UNKNOWN_VARIANT', keyPath, `"${value}" is not a built-in variant; it may come from a plugin.`),
		...(match === undefined ? {} : { suggestion: `Did you mean "${match}"?` })
	};
}

/** An unknown key: a confirmed error only in a closed object of a full schema, otherwise a warning; none where keys are open. */
export function unknownKeyFinding(
	key: string,
	schema: NodeSchema,
	coverage: Coverage,
	path: string
): Diagnostic | undefined {
	if (schema.additionalProperties === 'allow') return undefined;
	const certain = schema.additionalProperties === 'deny' && coverage === 'full';
	const match = suggestion(key, Object.keys(schema.properties ?? {}));
	return {
		code: 'CFG_UNKNOWN_KEY',
		severity: certain ? 'error' : 'warning',
		path,
		message: `Unknown property "${key}" for this ${coverage} schema.`,
		confidence: certain ? 'certain' : 'unknown',
		...(match === undefined ? {} : { suggestion: `Did you mean "${match}"?` })
	};
}

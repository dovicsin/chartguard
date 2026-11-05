import { readFileSync } from 'node:fs';

import ts from 'typescript';

import { verifiedCompiler } from './lock.mjs';
import { upstreamChanged } from './nodes.mjs';

const GENERATOR = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** The source id of the TypeScript compiler, whose lib files facts about DOM and built-in types cite. */
export const COMPILER_SOURCE = 'typescript';

/**
 * Checked lookups into upstream declarations. Each throws with the library name when the
 * declarations no longer have the expected shape, so an upstream change fails generation
 * loudly instead of producing a silently different artifact.
 */
export function typeLookups(checker, library) {
	const changed = upstreamChanged(`${library} types`);
	const property = (type, name) => {
		const symbol = checker.getPropertyOfType(type, name);
		if (symbol === undefined) throw changed(`no "${name}" property`);
		return symbol;
	};
	const propertyType = (type, name) => checker.getNonNullableType(checker.getTypeOfSymbol(property(type, name)));
	const indexValueType = (type) => {
		const info = checker.getIndexInfoOfType(type, ts.IndexKind.String);
		if (info === undefined) throw changed('expected a string index signature');
		return info.type;
	};
	const elementType = (arrayType) => {
		const [element] = checker.getTypeArguments(arrayType);
		if (element === undefined) throw changed('expected an array type');
		return element;
	};
	return { checker, property, propertyType, indexValueType, elementType };
}

/** The members of a union type, or the type itself. */
export function unionMembers(type) {
	return type.isUnion() ? type.types : [type];
}

/**
 * The artifact header shared by every generator; only the library-specific parts differ. It names
 * everything the artifact is built from: the library, the compiler that read it, and the generator.
 */
export function artifactOf({ library, sourceId, pin, definitions, root }) {
	const compiler = verifiedCompiler(ts.version);
	return {
		irVersion: 1,
		library,
		libraryVersion: pin.version,
		// Not full until official examples pass against the runtime (CG-01-08).
		coverage: 'partial',
		generator: { name: GENERATOR.name, version: GENERATOR.version },
		sources: {
			[sourceId]: {
				kind: 'npm-package',
				locator: `${pin.package}@${pin.version}`,
				integrity: pin.integrity,
				license: pin.license.spdx
			},
			[COMPILER_SOURCE]: {
				kind: 'npm-package',
				locator: `${compiler.package}@${compiler.version}`,
				integrity: compiler.integrity,
				license: compiler.license.spdx
			}
		},
		definitions,
		root
	};
}

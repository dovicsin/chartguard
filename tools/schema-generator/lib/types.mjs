import ts from 'typescript';

/**
 * Checked lookups into upstream declarations. Each throws with the library name when the
 * declarations no longer have the expected shape, so an upstream change fails generation
 * loudly instead of producing a silently different artifact.
 */
export function typeLookups(checker, library) {
	const changed = (what) => new Error(`${library} types changed: ${what}`);
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
	return { property, propertyType, indexValueType, elementType };
}

/** The members of a union type, or the type itself. */
export function unionMembers(type) {
	return type.isUnion() ? type.types : [type];
}

/** The artifact header shared by every generator; only the library-specific parts differ. */
export function artifactOf({ library, sourceId, pin, definitions, root }) {
	return {
		irVersion: 1,
		library,
		libraryVersion: pin.version,
		// Not full until official examples pass against the runtime (CG-01-08).
		coverage: 'partial',
		generator: { name: '@chartguard/schema-generator', version: '0.1.0' },
		sources: {
			[sourceId]: {
				kind: 'npm-package',
				locator: `${pin.package}@${pin.version}`,
				integrity: pin.integrity,
				license: pin.license.spdx
			}
		},
		definitions,
		root
	};
}

import { isAbsolute, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

import type { AnalysedFile } from './extract.js';

/** One root of a Program: its file, the name the caller gave and the resolved name it is known by. */
export interface Root extends AnalysedFile {
	readonly root: string;
}

/** Reads a file the Program needs from disk; a session passes one that reuses what did not change. */
export type DiskReader = (fromDisk: ts.CompilerHost['getSourceFile']) => ts.CompilerHost['getSourceFile'];

/**
 * A host for a Program whose roots are given texts (which may differ from the files on disk: an
 * editor's buffers); every other file is read from disk, through `reader` when given. Nothing is written.
 */
export function projectHost(
	options: ts.CompilerOptions,
	roots: ReadonlyMap<string, Root>,
	reader: DiskReader = (fromDisk) => fromDisk
): ts.CompilerHost {
	const host = ts.createCompilerHost(options, true);
	const fromDisk = reader(host.getSourceFile.bind(host));
	// TypeScript asks with `/` separators on every platform: compare resolved paths, never strings.
	host.getSourceFile = (name, ...rest) => roots.get(resolve(name))?.file ?? fromDisk(name, ...rest);
	// The given texts exist for module resolution too, whether or not they are on disk yet (an editor's buffers).
	const exists = host.fileExists.bind(host);
	const read = host.readFile.bind(host);
	host.fileExists = (name) => roots.has(resolve(name)) || exists(name);
	const directoryExists = host.directoryExists?.bind(host);
	// By path segment, never by text (E2): `..cache` is inside; another drive is not.
	const holdsRoot = (name: string): boolean =>
		[...roots.keys()].some((root) => {
			const inside = relative(resolve(name), root);
			return inside !== '' && !isAbsolute(inside) && inside.split(sep)[0] !== '..';
		});
	host.directoryExists = (name) => holdsRoot(name) || (directoryExists?.(name) ?? true);
	host.readFile = (name) => roots.get(resolve(name))?.file.text ?? read(name);
	host.writeFile = () => undefined;
	return host;
}

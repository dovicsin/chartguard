import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';

import { Extraction, refused } from './extract.js';
import { type DiskReader, projectHost, type Root } from './host.js';
import { guarded, inputRefusal } from './limits.js';
import { type Rule, rulesOf } from './patterns.js';
import { READ_ONLY, rootNameOf, sourceFileOf } from './program.js';
import type { ProjectAnalysis, ProjectOptions } from './project.js';
import { compilerOptionsOf, locateTsconfig } from './tsconfig.js';

/** A file read from disk, with what identifies its content there (size and modification time). */
interface Cached {
	/** Undefined for a file that is not there: read again once it is. */
	readonly stamp: string | undefined;
	readonly file: ts.SourceFile | undefined;
}

const stampOf = (name: string): string | undefined => {
	try {
		const { size, mtimeMs } = statSync(name);
		return `${String(size)}:${String(mtimeMs)}`;
	} catch {
		return undefined;
	}
};

/**
 * One project read again and again as its files change (CG-06-04): an editor, a language server or a
 * lint run analyses file after file in the same session. Every file whose size and time on disk are
 * the same is reused as TypeScript parsed and bound it, so a reading after the first costs what changed.
 * The results are exactly a fresh `analyzeProject`'s. Nothing runs; Node only.
 */
export class ProjectSession {
	private readonly disk = new Map<string, Cached>();
	private readonly options: ts.CompilerOptions;

	constructor(
		/** The tsconfig whose compiler options the session's Programs are built with, if any. */
		readonly tsconfig: string | undefined,
		private readonly rules: readonly Rule[]
	) {
		this.options = { ...(tsconfig === undefined ? {} : compilerOptionsOf(tsconfig)), ...READ_ONLY };
	}

	/** `source`, the text of `fileName` (an editor's buffer or the file on disk), read in the session's Program. */
	analyze(fileName: string, source: string): ProjectAnalysis {
		const { tsconfig } = this;
		const refusal = inputRefusal(source, fileName);
		if (refusal !== undefined) return { ...refused(refusal), fileName, tsconfig };
		const output = guarded(fileName, () => this.read(fileName, source), refused);
		return { ...output, fileName, tsconfig };
	}

	private read(fileName: string, source: string): ReturnType<Extraction['read']> {
		const key = rootNameOf(resolve(fileName));
		const root: Root = { file: sourceFileOf(key, source), fileName, root: key };
		const { options } = this;
		const host = projectHost(options, new Map([[key, root]]), this.reader);
		return new Extraction(ts.createProgram({ rootNames: [key], options, host }), this.rules).read(root);
	}

	/** A file from disk is read again only when its size or time changed. */
	private readonly reader: DiskReader =
		(fromDisk) =>
		(name, ...rest) => {
			const stamp = stampOf(name);
			const known = this.disk.get(name);
			if (known !== undefined && known.stamp === stamp) return known.file;
			const file = fromDisk(name, ...rest);
			this.disk.set(name, { stamp, file });
			return file;
		};
}

/**
 * A session for the project of `fileName`: its nearest tsconfig (or the one `tsconfig` names, or none
 * with `false`). An unusable tsconfig throws `ProjectConfigError`, malformed patterns `PatternError`.
 */
export function openSession(fileName: string, { tsconfig = true, ...options }: ProjectOptions = {}): ProjectSession {
	const rules = rulesOf(options.patterns);
	return new ProjectSession(locateTsconfig(fileName, tsconfig), rules);
}

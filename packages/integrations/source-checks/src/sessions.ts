import { resolve } from 'node:path';

import type { ChartPattern } from '@chartguard/analysis-typescript';
import { openSession, ProjectConfigError, type ProjectSession } from '@chartguard/analysis-typescript/project';

import { SettingsError } from './settings.js';

/**
 * Project mode (CG-06-03 part 3): one analysis session per tsconfig for a lint run or an editor, so
 * every file after the first in a project reads only what changed (`ProjectSession`, CG-06-04).
 */
export class Sessions {
	private readonly open = new Map<string, ProjectSession>();

	constructor(
		/** `true`: the nearest tsconfig of each file; a path: that tsconfig, relative to ESLint's working directory. */
		private readonly project: true | string,
		private readonly patterns: readonly ChartPattern[],
		/** Where the settings are read, naming them in a setup error. */
		private readonly prefix: string
	) {}

	/** The session of `fileName`'s project; an unusable tsconfig stops the lint, named by its setting. */
	sessionFor(fileName: string, cwd: string): ProjectSession {
		const tsconfig = this.project === true ? true : resolve(cwd, this.project);
		let fresh: ProjectSession;
		try {
			fresh = openSession(fileName, { tsconfig, patterns: this.patterns });
		} catch (error) {
			if (error instanceof ProjectConfigError)
				throw new SettingsError(this.prefix, [`${this.prefix}.project: ${error.message}`]);
			throw error;
		}
		const key = fresh.tsconfig ?? '';
		const known = this.open.get(key);
		if (known !== undefined) return known;
		this.open.set(key, fresh);
		return fresh;
	}
}

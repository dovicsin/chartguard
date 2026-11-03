import { relative, resolve } from 'node:path';

import { type AnalysisOutput, extractStaticConfigs, PatternError } from '@chartguard/analysis-typescript';
import ts from 'typescript';

import { type Engine, findingsOf, type Reading, type SourceFinding } from './findings.js';
import { Sessions } from './sessions.js';
import { type ChartGuardSettings, readSettings, SettingsError } from './settings.js';
import { reviewOf, Validators } from './validators.js';

/**
 * Checks chart configs in JavaScript and TypeScript source (CG-06-04): the configs a file hands to
 * Chart.js, ECharts or Highcharts, read without running anything, validated and reviewed, each
 * finding at the range that wrote its value, with the edits the engine verified. One checker per
 * settings: its validators, built schemas and project sessions are kept with it.
 */
export class SourceChecker {
	readonly settings: ChartGuardSettings;
	private readonly validators: Validators;
	private readonly sessions: Sessions | undefined;

	/** `given` is checked first: settings that cannot be used throw `SettingsError`, named under `prefix`. */
	constructor(
		given: unknown,
		private readonly prefix: string
	) {
		this.settings = readSettings(given, prefix);
		this.validators = new Validators(this.settings, prefix);
		const { project, patterns } = this.settings;
		this.sessions = project === false ? undefined : new Sessions(project, patterns, prefix);
	}

	/** The findings in `text`, the content of `fileName` (an editor's buffer or the file on disk). */
	check(text: string, fileName: string, cwd: string): SourceFinding[] {
		const output = this.extracted(text, fileName, cwd);
		// A file TypeScript cannot read (syntax errors, limits): nothing read from its tree is reliable, as
		// in the CLI. Its uses are still listed (incomplete), and their values would be checked (A7).
		if (!output.readable) return [];
		const reading: Reading = {
			file: ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true),
			inFile: (range) => resolve(range.file) === resolve(fileName),
			where: (range) =>
				`${relative(cwd, range.file).split('\\').join('/')}:${String(range.line)}:${String(range.column)}`
		};
		return findingsOf(output.uses, reading, this.engineFor(fileName));
	}

	/** The validators and review for one file: the version it runs (`"auto"`: its install) and the registries. */
	private engineFor(fileName: string): Engine {
		const { validators, settings } = this;
		return {
			validate: (library, config, options) => {
				const version = validators.versionFor(library, fileName);
				return validators.validatorFor(library, fileName)(config, {
					...options,
					...(version === undefined ? {} : { libraryVersion: version }),
					...(settings.registries === undefined ? {} : { registries: settings.registries })
				});
			},
			review: (library, config) => reviewOf(library)(config, settings.quality)
		};
	}

	/** The file read alone, or in its project's session (project mode). */
	private extracted(text: string, fileName: string, cwd: string): AnalysisOutput {
		try {
			if (this.sessions === undefined)
				return extractStaticConfigs(text, fileName, { patterns: this.settings.patterns });
			return this.sessions.sessionFor(fileName, cwd).analyze(fileName, text);
		} catch (error) {
			if (error instanceof PatternError)
				throw new SettingsError(this.prefix, [`${this.prefix}.patterns: ${error.message}`]);
			throw error;
		}
	}
}

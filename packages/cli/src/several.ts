import { EXIT_OK, EXIT_USAGE } from './exit-codes.js';
import type { Format } from './invocation.js';
import type { Io } from './io.js';
import type { CheckedFile, UnusableFile } from './report.js';
import { printJson } from './report.js';
import { type RunProperties, sarifLog } from './sarif.js';

/** The run's properties over several files: partial as soon as one is. */
function mergedProperties(files: readonly CheckedFile[], mode: string): RunProperties {
	const [first] = files;
	const partial = files.some(({ properties }) => properties['coverage'] === 'partial');
	return {
		...first?.properties,
		mode,
		...(first?.properties['coverage'] === undefined ? {} : { coverage: partial ? 'partial' : 'full' })
	};
}

/**
 * The files one command checked, printed in one format (CG-06-02 part 2). One file as before;
 * several (whenever the invocation can name several): text grouped under `== <file>`, JSON as
 * `{ mode, files: [...] }`, SARIF as one log. A file that could not be used is listed with its
 * reason (and on stderr), the others are still printed, and the run exits 2; otherwise the worst
 * status of the files.
 */
export function printFiles(
	mode: string,
	results: readonly (CheckedFile | UnusableFile)[],
	{ format, several }: { readonly format: Format; readonly several: boolean },
	io: Io
): number {
	const checked = results.filter((result): result is CheckedFile => 'findings' in result);
	const unusable = results.filter((result): result is UnusableFile => 'error' in result);
	for (const { error } of unusable) io.err(`ChartGuard: ${error}`);
	if (format === 'sarif')
		printJson(
			sarifLog(
				checked.flatMap(({ findings }) => findings),
				mergedProperties(checked, mode)
			),
			io
		);
	else if (format === 'json') {
		const [only] = checked;
		if (!several && only !== undefined) printJson({ mode, ...only.json }, io);
		else
			printJson(
				{ mode, files: results.map((result) => ('error' in result ? result : { file: result.file, ...result.json })) },
				io
			);
	} else
		for (const result of checked) {
			if (several) io.out(`== ${result.file}`);
			result.text(io);
		}
	if (unusable.length > 0) return EXIT_USAGE;
	return Math.max(EXIT_OK, ...checked.map(({ exitCode }) => exitCode));
}

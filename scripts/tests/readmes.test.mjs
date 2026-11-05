import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/**
 * The public documents (CG-06-07): the root README, CONTRIBUTING, SECURITY and every package README
 * are tracked and published; `docs/` is local only. A link into it is broken for every reader, and an
 * example that no longer compiles teaches an API that does not exist.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Every package README below `packages/`, the reference's guides, and the repository's own public documents. */
function publicDocuments() {
	const readmes = [];
	const visit = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory() && !['node_modules', 'dist', 'tests'].includes(entry.name))
				visit(join(directory, entry.name));
			else if (entry.name === 'README.md') readmes.push(join(directory, entry.name));
		}
	};
	visit(join(ROOT, 'packages'));
	const guides = join(ROOT, 'apps', 'reference', 'guides');
	const guideFiles = readdirSync(guides)
		.filter((name) => name.endsWith('.md'))
		.map((name) => join(guides, name));
	return [
		...['README.md', 'CONTRIBUTING.md', 'SECURITY.md'].map((name) => join(ROOT, name)),
		...readmes.sort(),
		...guideFiles.sort()
	];
}

/** A mention of the local `docs/` folder: a link target or a path (`../../docs/…`), never a URL's segment. */
const DOCS = /(?:^|[\s(`"'[])(?:\.\.\/)*docs\/[\w./-]/u;

test('no public document links to or names the local docs/ folder, which is never published', () => {
	const found = publicDocuments().flatMap((file) =>
		readFileSync(file, 'utf8')
			.split('\n')
			.flatMap((line, index) => (DOCS.test(line) ? [`${relative(ROOT, file)}:${String(index + 1)}`] : []))
	);
	assert.deepEqual(found, []);
});

test('the docs/ pattern catches links and paths, not words that end in docs', () => {
	for (const line of ['see [status](../../docs/00-status.md)', 'See `docs/specs/x.md`', 'in docs/14-roadmap.md'])
		assert.equal(DOCS.test(line), true, line);
	for (const line of ['https://www.chartjs.org/docs/latest/', 'mydocs/x', 'the docs are local'])
		assert.equal(DOCS.test(line), false, line);
});

/** The `ts` and `js` blocks of a Markdown text, with the line each starts on. */
export function codeBlocks(text) {
	const blocks = [];
	let current;
	for (const [index, line] of text.split('\n').entries()) {
		const fence = /^```(\w*)\s*$/u.exec(line);
		if (fence === null) current?.lines.push(line);
		else if (current === undefined) current = { language: fence[1], line: index + 2, lines: [] };
		else {
			if (current.language === 'ts' || current.language === 'js')
				blocks.push({ ...current, code: current.lines.join('\n') });
			current = undefined;
		}
	}
	return blocks;
}

/**
 * The inputs examples take from the reader's application: declared once, so each example stays as a
 * reader would write it, and `any` where the example hands a value to a typed library API.
 */
const INPUTS = `
declare const config: any;
declare const option: any;
declare const options: any;
declare const source: string;
declare const fileName: string;
declare const signal: AbortSignal;
declare const canvas: HTMLCanvasElement;
declare const element: HTMLElement;
declare const artifact: unknown;
declare const artifactPath: string;
declare const next: number[];
declare const settings: any;
`;

test('every ts and js example of a public document compiles against the built packages', () => {
	// Inside the repository, so `@chartguard/*`, `chart.js`, `echarts` resolve as a reader's install does.
	const directory = join(ROOT, 'node_modules', '.cache', 'readme-examples');
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, 'inputs.d.ts'), INPUTS);
	const files = publicDocuments().flatMap((file) =>
		codeBlocks(readFileSync(file, 'utf8')).map(({ language, line, code }, index) => {
			const name = `${relative(ROOT, file).replaceAll(/[\\/]/gu, '_')}-${String(index)}.${language === 'ts' ? 'mts' : 'mjs'}`;
			writeFileSync(join(directory, name), `${code}\nexport {};\n`);
			return { name, origin: `${relative(ROOT, file)}:${String(line)}` };
		})
	);
	assert.ok(files.length >= 12, String(files.length));
	const program = ts.createProgram(
		[join(directory, 'inputs.d.ts'), ...files.map(({ name }) => join(directory, name))],
		{
			noEmit: true,
			strict: true,
			allowJs: true,
			checkJs: true,
			skipLibCheck: true,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			target: ts.ScriptTarget.ES2022,
			lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
			types: ['node']
		}
	);
	const problems = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
		const at =
			diagnostic.file === undefined
				? ''
				: `${files.find(({ name }) => diagnostic.file?.fileName === join(directory, name))?.origin ?? diagnostic.file.fileName} `;
		return `${at}${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
	});
	assert.deepEqual(problems, []);
	rmSync(directory, { recursive: true, force: true });
});

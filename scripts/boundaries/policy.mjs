const LIBRARIES = ['chartjs', 'echarts', 'highcharts'];

const CHART_RUNTIMES = {
	chartjs: [/^chart\.js$/, /^chartjs-/, /^react-chartjs-/],
	echarts: [/^echarts(-|$)/, /^zrender$/],
	highcharts: [/^highcharts(-|$)/, /^@highcharts\//]
};

const CORE = '@chartguard/core';
const CONFIG_CORE = '@chartguard/config-core';
const QUALITY_CORE = '@chartguard/quality-core';
const ANALYSIS = '@chartguard/analysis-typescript';
const SCHEMA_GENERATOR = '@chartguard/schema-generator';
const SOURCE_CHECKS = '@chartguard/source-checks';
const CONFIG_ADAPTERS = LIBRARIES.map((library) => `@chartguard/config-${library}`);
const QUALITY_ADAPTERS = LIBRARIES.map((library) => `@chartguard/quality-${library}`);

/** Which chart library a package name belongs to, if it is a chart runtime or plugin. */
export function chartRuntimeOf(name) {
	return LIBRARIES.find((library) => CHART_RUNTIMES[library].some((pattern) => pattern.test(name)));
}

/** `provided`: modules the host the package runs in provides at run time (never installed, never declared). */
function rule({ internal = [], external = [], peer = [], provided = [], node = false } = {}) {
	return { internal, external, peer, provided, node };
}

function libraryRules(library) {
	return [
		[`@chartguard/config-${library}`, rule({ internal: [CORE, CONFIG_CORE] })],
		[`@chartguard/quality-${library}`, rule({ internal: [CORE, QUALITY_CORE] })],
		[
			`@chartguard/runtime-${library}`,
			rule({ internal: [CORE, `@chartguard/config-${library}`], peer: CHART_RUNTIMES[library] })
		]
	];
}

/**
 * The dependency law from the architecture docs. `external` and `peer` hold
 * exact names or patterns; `node` allows Node.js built-ins in source: `true` for the whole package,
 * or the package-relative files that may use them, which no other module of the package may import.
 * A workspace package missing from this table is itself a violation.
 */
export const POLICY = {
	[CORE]: rule(),
	[CONFIG_CORE]: rule({ internal: [CORE] }),
	[QUALITY_CORE]: rule({ internal: [CORE] }),
	/** Runs anywhere; only the `./project` entry (the tsconfig, the Program host and the session it uses) reads a project from disk (CG-03-02, CG-06-04). */
	[ANALYSIS]: rule({
		internal: [CORE],
		external: ['typescript'],
		node: ['src/project.ts', 'src/tsconfig.ts', 'src/host.ts', 'src/session.ts']
	}),
	/**
	 * The source checks editors and linters share (CG-06-04): Node where they read what a file's project
	 * installs; the findings and `./text` (one text read alone, for the playground) run without it.
	 */
	[SOURCE_CHECKS]: rule({
		internal: [CORE, ...CONFIG_ADAPTERS, ...QUALITY_ADAPTERS, ANALYSIS, SCHEMA_GENERATOR],
		external: ['typescript'],
		node: ['src/index.ts', 'src/check.ts', 'src/sessions.ts', 'src/install.ts', 'src/validators.ts']
	}),
	/** ESLint's adapter over the source checks; runs where ESLint runs. */
	'@chartguard/eslint-plugin': rule({ internal: [SOURCE_CHECKS], peer: ['eslint'] }),
	/** A language server over stdio (CG-06-04): the source checks for any editor that speaks LSP; no dependency beyond them. */
	'@chartguard/language-server': rule({ internal: [SOURCE_CHECKS], node: true }),
	/**
	 * The VS Code extension (CG-06-05): the language client, and the server it bundles and runs apart.
	 * `vscode` is the editor's own module, provided at run time, never installed.
	 */
	chartguard: rule({
		internal: ['@chartguard/language-server'],
		external: ['vscode-languageclient'],
		provided: ['vscode'],
		node: true
	}),
	/** Reads a chart library's declarations and runtime files from a project; never imports or runs them. */
	[SCHEMA_GENERATOR]: rule({ internal: [CONFIG_CORE], external: ['typescript'], node: true }),
	'@chartguard/cli': rule({
		internal: [CORE, QUALITY_CORE, ...CONFIG_ADAPTERS, ...QUALITY_ADAPTERS, ANALYSIS, SCHEMA_GENERATOR],
		node: true
	}),
	/** A browser app: published adapter entry points and the two runtimes it renders with; no Node built-ins. */
	'@chartguard/playground': rule({
		internal: [CORE, ...CONFIG_ADAPTERS, ...QUALITY_ADAPTERS, SOURCE_CHECKS],
		// fflate: deflate for shared links (CG-06-06 part 2), synchronous so the browser gate can await it (E61).
		// typescript: the source a user runs in the sandbox is transpiled in the page (CG-06-06 part 4).
		external: [...CHART_RUNTIMES.chartjs, ...CHART_RUNTIMES.echarts, 'date-fns', 'fflate', 'typescript']
	}),
	/** The reference site's generator (CG-06-07): build-time scripts that read the packages' catalogs. */
	'@chartguard/reference': rule({ internal: [QUALITY_CORE], external: ['marked', 'typescript'] }),
	...Object.fromEntries(LIBRARIES.flatMap(libraryRules))
};

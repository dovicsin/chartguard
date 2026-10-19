/**
 * Official example corpora, pinned by commit. `select` picks the example files from the
 * repository tree; `extract` turns one file into the code that builds a config; `page`, when
 * set, names a sibling file kept with it (the HTML that loads a demo's modules). All of it runs at
 * import time only (network); tests read the corpus files offline. A corpus whose license does
 * not clear redistribution (`redistributable: false`) is written only to the local cache.
 */
export const SOURCES = {
	chartjs: {
		repository: 'chartjs/Chart.js',
		ref: 'v4.5.1',
		commit: '9c5cf9fac7ec04a71b516e2aff3f7d76876be369',
		license: 'MIT',
		licensePath: 'LICENSE.md',
		select: (path) => path.startsWith('docs/samples/') && path.endsWith('.md') && path !== 'docs/samples/utils.md',
		/** The ```js chart-editor block of a docs sample; prose and other blocks are not kept. */
		extract: (text) => /```js chart-editor\n([\s\S]*?)```/.exec(text)?.[1]
	},
	echarts: {
		repository: 'apache/echarts-examples',
		ref: 'gh-pages',
		commit: '88ca004030e999073a15303e5fe32462b8fefae2',
		license: 'Apache-2.0',
		licensePath: 'LICENSE',
		select: (path) => /^public\/examples\/ts\/[^/]+\.ts$/.test(path),
		extract: (text) => text
	},
	highcharts: {
		repository: 'highcharts/highcharts',
		ref: 'v13.1.1',
		commit: '81b13135ebaf3a2bedc9383b7f4aa84bde77eda6',
		license: 'LicenseRef-Highsoft',
		licensePath: 'license.txt',
		redistributable: false,
		select: (path) => /^samples\/highcharts\/demo\/[^/]+\/demo\.js$/.test(path),
		extract: (text) => text,
		page: (path) => path.replace(/demo\.js$/, 'demo.html')
	}
};

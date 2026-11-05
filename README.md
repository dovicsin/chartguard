# ChartGuard

ChartGuard checks chart configurations for **Chart.js**, **Apache ECharts** and **Highcharts** before they are drawn. It tells you which values the chart library would reject or misread, and separately gives advice on charts that may mislead or exclude readers. Its checks never run your code; only the playground runs source, when you ask it to, in a sandboxed frame without network access.

> **Status: pre-release (0.x), partial coverage.** Everything is a pre-release: the npm packages, the VS Code extension, the GitHub Action, the playground and the reference. A minor version may still change the API. A clean result means "no confirmed error was found", not "the config is correct".

**Try it in the browser:** the [playground](https://dovicsin.github.io/chartguard/) checks a JSON config or JavaScript/TypeScript source and draws it next to the verdict. The [reference](https://dovicsin.github.io/chartguard/reference/) explains every finding code, every quality rule and every package API, with guides for [getting started](https://dovicsin.github.io/chartguard/reference/guides/getting-started.html), [CI](https://dovicsin.github.io/chartguard/reference/guides/ci.html) and [editors](https://dovicsin.github.io/chartguard/reference/guides/editors.html).

## What it finds

```sh
$ npx chartguard validate --library chartjs --file chart.json
chartjs invalid (coverage: partial; schema 4.5.1, sha256-75174f7a234c)
  WARNING CFG_UNKNOWN_KEY $.options.scales.y.beginAtZerro: Unknown property "beginAtZerro" for this partial schema. Did you mean "beginAtZero"?
  ERROR CFG_TYPE $.options.scales.y.min: Expected number | function, got string.
```

- **Validation** (`CFG_*`): wrong types and values, unknown options (reported as warnings, with the nearest known name), deprecated options with the library's own rename as a fix, values the library ignores, required keys, plugins and chart types that are not registered. Each finding is at the path, or in source at the range, that wrote the value.
- **Quality review** (`VIS_*`, advisory): bars that do not start at zero, reversed or dual value axes, negative values in a pie, series in the same or a low-contrast colour, placeholder titles and legend entries, unlabelled value axes, data not described to assistive technology, keyboard access turned off, motion that runs on by itself. Advice never makes a config invalid, and a fix that changes the drawing is only suggested.
- **Configs in source** (`analyze`, ESLint, editors): the configs a JavaScript or TypeScript file hands to `new Chart`, `setOption`, `Highcharts.chart` or a React wrapper are found by where the call comes from and read with the TypeScript compiler, through imports, spreads and simple builders, without running anything. What cannot be read statically is reported as unknown, never guessed.

## Integrations

| Where          | What                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Command line   | `@chartguard/cli`: `validate`, `quality`, `analyze` (JavaScript/TypeScript source), `schema build`; text, JSON, SARIF or GitHub annotations. |
| ESLint 9       | `@chartguard/eslint-plugin`: `valid-config`, `config-warnings` (renames as `--fix`), `chart-quality` (edits as suggestions).                 |
| VS Code        | [ChartGuard](https://marketplace.visualstudio.com/items?itemName=chartguard.chartguard) on the Marketplace, as a pre-release.                |
| Any LSP editor | `@chartguard/language-server`: `chartguard-language-server --stdio`.                                                                         |
| GitHub Actions | This repository is an action: annotations on the lines that wrote the values, an optional SARIF log for code scanning.                       |
| At run time    | `@chartguard/runtime-{chartjs,echarts,highcharts}`: a config checked when the chart is created or updated, opt-in per chart.                 |
| Your own code  | `@chartguard/config-{chartjs,echarts,highcharts}` to validate, `@chartguard/quality-{chartjs,echarts,highcharts}` to review.                 |

## Packages

Each package installs on its own; an adapter never pulls in another chart library.

- `@chartguard/core`: findings, result status and fixes shared by every package.
- `@chartguard/config-core`: the validation engine; `@chartguard/config-{chartjs,echarts,highcharts}`: one schema each.
- `@chartguard/quality-core`: the chart model and the quality rules; `@chartguard/quality-{chartjs,echarts,highcharts}`: one adapter each.
- `@chartguard/analysis-typescript`: finds and reads chart configs in JavaScript and TypeScript source.
- `@chartguard/source-checks`: the findings and verified edits the ESLint plugin and the language server share.
- `@chartguard/runtime-{chartjs,echarts,highcharts}`, `@chartguard/cli`, `@chartguard/eslint-plugin`, `@chartguard/language-server`: the integrations above.
- `@chartguard/schema-generator`: builds a schema from a library's own declarations (the full Highcharts schema on your machine).

The [API reference](https://dovicsin.github.io/chartguard/reference/api/index.html) documents every export.

## Install

Node.js 22.12 or later. Every package loads with `import` and with `require`, and is published from CI with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

```sh
npm install --save-dev @chartguard/cli
npx chartguard validate --library chartjs --file "charts/**/*.json"
npx chartguard analyze --library echarts --file src/chart.ts
npx chartguard quality --library chartjs --file chart.json
```

```ts
import { validate } from '@chartguard/config-chartjs';

const { status, diagnostics } = validate({ type: 'bar', data: { datasets: [] }, options: { indexAxis: 'z' } });
```

Exit codes: `0` nothing fails, `1` findings that fail (`--fail-on error|warning|never`), `2` your input or invocation is unusable, `3` a ChartGuard defect (please report it).

### GitHub Actions

```yaml
- uses: actions/checkout@v5
- uses: dovicsin/chartguard@v0.1.1 # a release tag, never moved
  with:
    command: validate # or analyze, quality (advisory)
    library: chartjs
    files: |
      charts/**/*.json
    fail-on: error
    chartguard-version: 0.1.1 # the published CLI; empty builds it from the action's checkout
    sarif-file: chartguard.sarif # optional, for github/codeql-action/upload-sarif
```

A complete workflow to copy, with the SARIF upload, is [`examples/github/chartguard.yml`](examples/github/chartguard.yml). Inputs reach the action only as environment variables, never as script text.

## Principles and limits

- **Partial coverage, said out loud.** The Chart.js and ECharts schemas are generated from the `chart.js@4.5.1` and `echarts@6.1.0` declarations and checked against each library's runtime and official examples. Every result says `valid`, `partial` or `invalid` and which schema checked it. For another minor or patch version, confirmed errors are reported as warnings; another major is not validated.
- **Highcharts** ships only a hand-curated subset: its license does not allow distributing a schema derived from it. `npx chartguard schema build --library highcharts` builds the full schema on your machine from your installed `highcharts`, and every tool then uses it for exactly that version.
- **Unknown stays unknown.** A value built at run time, a plugin ChartGuard does not know, or a part of the source it cannot read is reported as partial, never as a confident error.
- **Nothing is run.** Source is read with the TypeScript compiler, never executed (the playground runs it only on request, in an isolated frame); validators never call getters or your callbacks. No published package reaches the network or starts a process.
- **Independent packages.** Each adapter installs on its own and never pulls in another chart library.
- **Quality rules are advice.** They depend on context, so they never make a config invalid, and you can turn each off or give the page context the chart leaves to it.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the checks a change must pass and how releases are made. Security reports go through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE): free to use, modify and distribute.

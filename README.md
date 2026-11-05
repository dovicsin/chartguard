# ChartGuard

Validates chart configurations for **Chart.js**, **Apache ECharts** and **Highcharts**, and flags visualization patterns that may mislead.

> **Status: early development, partial coverage.** The Chart.js and ECharts schemas are generated from the `chart.js@4.5.1` and `echarts@6.1.0` type declarations. Highcharts ships only a hand-curated subset (its license does not allow distributing a derived schema); `chartguard schema build --library highcharts` generates the full schema locally from your installed `highcharts`. Coverage is **partial** everywhere, so a clean result means "no confirmed error", not "fully compatible". Everything is pre-release (0.x): the npm packages, the VS Code extension, the GitHub Action, the [playground](https://dovicsin.github.io/chartguard/) and the [reference](https://dovicsin.github.io/chartguard/reference/).

## Packages

| Package                                            | Purpose                                                        |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `@chartguard/core`                                 | Diagnostics, result status, shared helpers                     |
| `@chartguard/config-core`                          | Schema DSL and validation engine                               |
| `@chartguard/config-{chartjs,echarts,highcharts}`  | Per-library option schemas                                     |
| `@chartguard/quality-core`                         | Normalized chart model and advisory quality rules              |
| `@chartguard/quality-{chartjs,echarts,highcharts}` | Per-library normalizers                                        |
| `@chartguard/runtime-{chartjs,echarts,highcharts}` | Opt-in `validateBeforeCreate` wrappers                         |
| `@chartguard/analysis-typescript`                  | Static config extraction from JS/TS source, without running it |
| `@chartguard/schema-generator`                     | Builds a schema from a library's installed type declarations   |
| `@chartguard/cli`                                  | `chartguard validate \| quality \| analyze \| schema build`    |

Every adapter installs on its own and never pulls in another chart library.

## Requirements

Node.js 22.12+ (developed and tested on Node 26, the active LTS; also 22 and 24) and npm 11+. Every package loads with `import` and with `require`.

## Setup

```bash
npm install
npm run check
```

## Scripts

| Script                            | What it does                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run build`                   | `tsc -b` (project references), local Highcharts schema, playground bundle                   |
| `npm test`                        | Node test runner over every `tests/` directory of `packages`, `apps`, `scripts` and `tools` |
| `npm run test:coverage`           | Tests with c8 coverage thresholds (`.c8rc.json`)                                            |
| `npm run lint` / `fix-lint`       | ESLint (strict type-checked), zero warnings allowed                                         |
| `npm run format` / `fix-format`   | Prettier                                                                                    |
| `npm run knip`                    | Unused files, exports and dependencies                                                      |
| `npm run boundaries`              | Package dependency and import boundaries                                                    |
| `npm run schema:generate`         | Regenerate schema artifacts from pinned upstream                                            |
| `npm run schema:check`            | Fail if a committed schema artifact is stale                                                |
| `npm run api:check` / `api:write` | Compare / record the public API surface of every package                                    |
| `npm run check`                   | everything above, then tests with coverage                                                  |

Git hooks (husky) only check, they never change files: **pre-commit** runs `npm run check`, and **pre-push** runs every check. Run `npm run fix-lint` and `npm run fix-format` yourself and review the diff.

## Usage

```bash
node packages/cli/bin/chartguard.mjs validate --library chartjs --file examples/chartjs-invalid.json
node packages/cli/bin/chartguard.mjs quality --library chartjs --file examples/chartjs-quality.json --json
node packages/cli/bin/chartguard.mjs analyze --library chartjs --file examples/chartjs-source.ts
node packages/cli/bin/chartguard.mjs validate --library chartjs --file my-chart.json --library-version auto
node packages/cli/bin/chartguard.mjs schema build --library highcharts --dir my-project
```

`--library-version <version|auto>` tells the validator which version you run (`auto` reads it from `node_modules`, upward from the file). The schemas describe one exact upstream version (Chart.js 4.5.1, ECharts 6.1.0); for another minor or patch, confirmed errors are reported as warnings, and another major is not validated.

Exit codes: `0` no confirmed errors, `1` confirmed errors, `2` bad arguments or unusable input (the reason is on stderr; with `--json`, stdout is `{ "error": { "kind", "message" } }`), `3` internal failure.

```ts
import { validate } from '@chartguard/config-highcharts';

const { status, diagnostics } = validate({ chart: { type: 'line' }, series: [{ data: [1, 2] }] });
```

## GitHub Actions

The repository is a GitHub Action: findings become annotations on the lines of the values they are about, the step fails as `fail-on` decides, and a SARIF log can go to code scanning. A complete workflow to copy is `examples/github/chartguard.yml`.

```yaml
- uses: actions/checkout@v5
- uses: dovicsin/chartguard@main # pin a release tag or a commit SHA
  with:
    command: validate # or analyze (JavaScript/TypeScript source), quality (advisory)
    library: chartjs
    files: |
      charts/**/*.json
    fail-on: error # warning, never
    sarif-file: chartguard.sarif # optional, for github/codeql-action/upload-sarif
```

Inputs: `command`, `library`, `files` and `ignore` (one pattern per line), `config` (a `chartguard.config.json`), `project` (a tsconfig for `analyze`), `library-version` (`auto` reads your install or lockfile), `fail-on`, `sarif-file`, `node-version`, and `chartguard-version` (a published `@chartguard/cli` to install; empty builds the CLI from the action's checkout). Output: `exit-code`. Inputs reach the action only as environment variables, never as script text. Outside Actions, `chartguard … --format github` prints the same annotations.

## Schema generation

`tools/schema-generator` (with the `@chartguard/schema-generator` package) reads the TypeScript declarations of the exact upstream version pinned in `packages/schema-generator/upstream-sources.json`, verifies the installed package against that pin and the lockfile integrity, and writes a SchemaIR artifact to `packages/config/<library>/src/generated/`. Declarations are only type-checked, never executed. Every fact carries provenance (`chart.js/dist/types/index.d.ts:<line>`).

## Ground rules

- A `config-*` package depends only on `core` and `config-core`, and a `quality-*` package only on `core` and `quality-core`.
- Static analysis never executes input code, and the validators never invoke getters.
- Report anything unknown or dynamic as `partial`. Never turn it into a confident error.
- Quality rules are advisory and never make a config invalid.

## License

[MIT](LICENSE): free to use, modify and distribute.

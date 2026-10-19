# ChartGuard

Validates chart configurations for **Chart.js**, **Apache ECharts** and **Highcharts**, and flags visualization patterns that may mislead.

> **Status: early development.** The Chart.js schema is generated from the `chart.js@4.5.1` type declarations; the ECharts and Highcharts schemas are still hand-curated subsets. Coverage is **partial** everywhere, so a clean result means "no confirmed error", not "fully compatible". The ESLint plugin has no rules yet.

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
| `@chartguard/cli`                                  | `chartguard validate \| quality \| analyze`                    |

Every adapter installs on its own and never pulls in another chart library.

## Requirements

Node.js 20.19+ and npm 11+.

## Setup

```bash
npm install
npm run check
```

## Scripts

| Script                          | What it does                                        |
| ------------------------------- | --------------------------------------------------- |
| `npm run build`                 | `tsc -b` over all packages (project references)     |
| `npm test`                      | Node test runner over `packages/**/tests`           |
| `npm run test:coverage`         | Tests with c8 coverage thresholds                   |
| `npm run lint` / `fix-lint`     | ESLint (strict type-checked), zero warnings allowed |
| `npm run format` / `fix-format` | Prettier                                            |
| `npm run knip`                  | Unused files, exports and dependencies              |
| `npm run boundaries`            | Package dependency and import boundaries            |
| `npm run schema:generate`       | Regenerate schema artifacts from pinned upstream    |
| `npm run schema:check`          | Fail if a committed schema artifact is stale        |
| `npm run check`                 | everything above, then tests with coverage          |

Git hooks (husky) only check, they never change files: **pre-commit** runs `npm run check`, and **pre-push** runs every check. Run `npm run fix-lint` and `npm run fix-format` yourself and review the diff.

## Usage

```bash
node packages/cli/bin/chartguard.mjs validate --library chartjs --file examples/chartjs-invalid.json
node packages/cli/bin/chartguard.mjs quality --library chartjs --file examples/chartjs-quality.json --json
node packages/cli/bin/chartguard.mjs analyze --library chartjs --file examples/chartjs-source.ts
node packages/cli/bin/chartguard.mjs validate --library chartjs --file my-chart.json --library-version auto
```

`--library-version <version|auto>` tells the validator which version you run (`auto` reads it from `node_modules`, upward from the file). The schemas describe one exact upstream version (Chart.js 4.5.1, ECharts 6.1.0); for another minor or patch, confirmed errors are reported as warnings, and another major is not validated.

Exit codes: `0` no confirmed errors, `1` confirmed errors, `2` bad arguments or unusable input, `3` internal failure.

```ts
import { validate } from '@chartguard/config-highcharts';

const { status, diagnostics } = validate({ chart: { type: 'line' }, series: [{ data: [1, 2] }] });
```

## Schema generation

`tools/schema-generator` reads the TypeScript declarations of the exact upstream version pinned in `tools/schema-generator/upstream-sources.json`, verifies the installed package against that pin and the lockfile integrity, and writes a SchemaIR artifact to `packages/config/<library>/src/generated/`. Declarations are only type-checked, never executed. Every fact carries provenance (`chart.js/dist/types/index.d.ts:<line>`).

## Ground rules

- A `config-*` package depends only on `core` and `config-core`, and a `quality-*` package only on `core` and `quality-core`.
- Static analysis never executes input code, and the validators never invoke getters.
- Report anything unknown or dynamic as `partial`. Never turn it into a confident error.
- Quality rules are advisory and never make a config invalid.

## License

[MIT](LICENSE): free to use, modify and distribute.

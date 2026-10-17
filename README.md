# ChartGuard

Validates chart configurations for **Chart.js**, **Apache ECharts** and **Highcharts**, and flags visualization patterns that may mislead.

> **Status: early starter.** Schemas are hand-curated **partial** subsets, so a clean result means "no confirmed error", not "fully compatible". The ESLint plugin has no rules yet.

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

Node.js 20.19+ and npm 10+.

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
| `npm run check`                 | build → lint → format → knip → coverage             |

Git hooks (husky): **pre-commit** runs the fixers and the full test suite, and **pre-push** runs every check.

## Usage

```bash
node packages/cli/bin/chartguard.mjs validate --library chartjs --file examples/chartjs-invalid.json
node packages/cli/bin/chartguard.mjs quality --library chartjs --file examples/chartjs-quality.json --json
node packages/cli/bin/chartguard.mjs analyze --library chartjs --file examples/chartjs-source.ts
```

Exit codes: `0` no confirmed errors, `1` confirmed errors, `2` invocation failure.

```ts
import { validate } from '@chartguard/config-highcharts';

const { status, diagnostics } = validate({ chart: { type: 'line' }, series: [{ data: [1, 2] }] });
```

## Ground rules

- A `config-*` package depends only on `core` and `config-core`, and a `quality-*` package only on `core` and `quality-core`.
- Static analysis never executes input code, and the validators never invoke getters.
- Report anything unknown or dynamic as `partial`. Never turn it into a confident error.
- Quality rules are advisory and never make a config invalid.

## License

[MIT](LICENSE): free to use, modify and distribute.

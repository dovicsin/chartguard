# Contributing to ChartGuard

ChartGuard is a portfolio project maintained by one person. Issues and pull requests are welcome; please read this first.

## Setup

- Node.js 20.19 or later, npm 10 or later.
- `npm ci`, then `npm run check`: build, package boundaries, schema artifacts, lint, format, unused code, and every test with coverage. A pull request is ready when `npm run check` passes.
- The full Highcharts schema cannot be distributed (license); `npm run build` generates it locally from the installed `highcharts`. Never commit anything under `packages/config/highcharts/src/generated/`.

## What a change needs

- **A test that fails without it.** A fix comes with the test that reproduces the defect; a feature with tests for valid, invalid and unknown input.
- **Unknown stays unknown.** The validator and the source analysis never turn something they cannot establish into a confident value or a confirmed error; they report it as partial or inconclusive.
- **No code execution.** Static analysis never runs the analysed code or a callback in it.
- **Independent packages.** A config package never imports another chart library or a chart runtime; `npm run boundaries` checks it.
- **Runtime evidence.** A claim about what a chart library accepts or rejects is backed by the runtime (`tools/conformance`), not by reading its types alone.
- **Public API.** If `npm test` reports an API surface change, decide whether it is breaking (major) or additive (minor), record it with `npm run api:write`, and add a changeset (`npm run changeset`) for each package that changes.
- Git hooks only check; they never rewrite files.

## Issues and triage

New issues are labelled `needs-triage`. The maintainer then adds a kind (`bug`, `false-positive`, `false-negative`, `enhancement`), the area (`area:*`) and the chart library (`lib:*`), or asks for a reproduction (`needs-repro`).

- A **false positive** (an error the chart library does not have) needs the config, the library version, and what the library does with it.
- A **false negative** (a config the library rejects or ignores without a finding) needs the same, and is fixed only with runtime evidence.
- Behaviour of the chart library itself is labelled `upstream`.

Security issues follow [SECURITY.md](SECURITY.md), not the issue tracker.

## License

By contributing you agree that your contribution is licensed under the MIT License of this repository.

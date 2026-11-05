# Getting started

ChartGuard checks chart configs for Chart.js, ECharts and Highcharts before they are drawn. It
tells you which values the runtime would reject or misread, and separately gives advice on how
the chart reads. It never runs your code.

**Status:** pre-release (0.x). The API may change between minor versions, and schema coverage is
**partial**. A clean result means that no confirmed error was found. It does not mean the config
is complete.

## Check a JSON config from the command line

```sh
npm install --save-dev @chartguard/cli
npx chartguard validate --library chartjs --file chart.json
```

The command exits with one of these codes:

- `0`: nothing fails;
- `1`: a confirmed error;
- `2`: your input could not be used;
- `3`: ChartGuard failed.

Each finding has a code (such as `CFG_TYPE`), the path of the value it is about, a severity and a
confidence. The [codes page](../codes.html) explains every code and what to do about it.

`chartguard validate --file "charts/**/*.json"` checks many files in one run.
`--library-version auto` checks against the version your project installs.

## Check configs in JavaScript and TypeScript source

```sh
npx chartguard analyze --library echarts --file "src/**/*.ts"
```

`analyze` finds the configs a file hands to the library, then validates each one. It looks for
`new Chart`, `setOption` on `echarts.init`, `Highcharts.chart` and the React wrappers. It finds
them by where the call is imported from, not by variable names. It reads the source without
running it: a value built at runtime is unknown, and a config that holds one is checked as
incomplete input.

## Validate in your code

Each library has a validator package with no runtime dependency on the library:

```ts
import { validate } from '@chartguard/config-chartjs';

const result = validate(config, { libraryVersion: '4.5.1' });
if (!result.valid) for (const finding of result.diagnostics) console.error(finding.code, finding.path, finding.message);
console.log(result.status, result.coverage); // e.g. "partial", "partial"
```

Read `status` as well as `valid`:

- `invalid`: a confirmed error;
- `partial`: something could not be decided;
- `valid`: a complete, authoritative check found nothing.

Every finding carries a `documentationUrl` that links to its explanation.

## Check when the chart is created

The runtime wrappers check what the library actually receives, including updates, without patching
the library:

```ts
import { Chart } from 'chart.js/auto';
import { guard } from '@chartguard/runtime-chartjs';

new Chart(canvas, guard(config)); // a config with confirmed errors is reported with console.warn
```

## Advice on how the chart reads

```ts
import { analyze } from '@chartguard/quality-chartjs';

const report = analyze(config, { context: { background: '#ffffff' } });
for (const finding of report.diagnostics) console.log(finding.code, finding.message);
```

The quality review flags things like bars that do not start at zero or colours that are hard to tell
apart. It is advice, never a verdict: it has no error severity and no `valid`. Each rule documents
its sources and limits on the [quality rules page](../rules.html).

## Next

- [Continuous integration](ci.html): fail a build on confirmed errors, and show findings on pull requests.
- [Editors](editors.html): findings as you type, in ESLint and VS Code.
- The [playground](../../) shows each example's findings next to what the runtime draws.

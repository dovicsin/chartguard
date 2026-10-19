# @chartguard/schema-generator

Generates ChartGuard schema artifacts from a chart library's own published TypeScript declarations and runtime code. Every fact in an artifact cites the line of the installed package it was read from; nothing from the package is executed.

ChartGuard's Chart.js and ECharts adapters ship their schemas. The Highcharts schema cannot ship: the Highcharts license does not clear redistributing option metadata derived from it. Build it on your machine, from your own installed `highcharts`, under your own license:

```sh
npx chartguard schema build --library highcharts
```

The schema is written to `node_modules/.cache/chartguard/highcharts-<version>.json` and used by `chartguard validate --library highcharts` for that installed version. A version of the same major as the one the generator was verified against (see `upstream-sources.json`) is read the same way; if any declaration shape or runtime fact the generator relies on is missing, the build fails and names it rather than writing a different schema.

```js
import { buildLocalSchema } from "@chartguard/schema-generator";
const { path, version, digest } = buildLocalSchema(process.cwd(), "highcharts");
```

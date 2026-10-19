# @chartguard/config-highcharts

Highcharts configuration validator. **Partial coverage**: a clean result means no confirmed error was found, not that the configuration is complete or correct (read `status`).

This package does **not** ship a schema derived from Highcharts. The Highcharts license does not clear redistributing option metadata derived from its declarations, so the full schema is generated on your machine from your own installed `highcharts`, under your own license.

## Two ways to validate

```ts
import { readFileSync } from "node:fs";
import { createValidator, validate } from "@chartguard/config-highcharts";

// 1. A small hand-written subset, always available.
validate(config);

// 2. The full option set of your installed version, from a locally generated schema artifact.
const validateFull = createValidator(JSON.parse(readFileSync(artifactPath, "utf8")));
validateFull(config, { libraryVersion: "13.1.1" });
```

`createValidator` throws for a malformed artifact or one generated for another library. A series without `type` takes `chart.type` at runtime; that series is reported as inconclusive (`CFG_AMBIGUOUS`), never checked against a guessed type.

A command that generates the artifact from an installed `highcharts` is not part of a release yet; inside the ChartGuard repository, `npm run build` writes it to `node_modules/.cache/chartguard/`.

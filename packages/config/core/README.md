# @chartguard/config-core

The validation engine the library adapters (`@chartguard/config-chartjs`, `-echarts`, `-highcharts`) are built on: it reads a schema artifact (a versioned, provenance-carrying description of a library's options), walks a config against it and reports `CFG_*` findings. You use it directly to describe a plugin's options for an adapter's `withExtensions`, or to validate against a schema artifact of your own.

**Status:** pre-release (0.x): not published to npm yet, and the API may still change between minor versions.

```ts
import { s } from "@chartguard/config-core";
import { withExtensions } from "@chartguard/config-chartjs";

// The options of a Chart.js plugin, so they are checked instead of reported unknown.
const validate = withExtensions([
	{ id: "datalabels", options: { "chartjs.plugins": { datalabels: s.object({ anchor: s.string(["center", "start", "end"]) }) } } }
]);
validate(config);
```

- **Schema builders (`s`):** `s.object`, `s.array`, `s.string([...])`, `s.number`, `s.boolean`, `s.union`, `s.any`, … describe options for extensions; a schema you are not sure of can be marked `inferred: true`, and its findings are reported as warnings.
- **Unknown is not wrong:** a schema part that does not cover every valid option is `partial`, and an option it does not know is a warning, not an error, unless the schema is complete there.
- **Rules over several options** (`ConfigRule`, `readOwn`, `itemsOf`) mirror one runtime check each; the adapters ship theirs.
- **Artifacts:** `checkArtifact` and `lowerArtifact` read a schema artifact (`SCHEMA_IR_VERSION`); `compatibility` and `parseVersion` decide how a requested library version relates to the schema's.

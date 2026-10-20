# @chartguard/config-chartjs

Dependency-light **partial starter** validator for Chart.js. Uses curated schema subset, not an authoritative complete option reference.

```ts
import { validate } from "@chartguard/config-chartjs";
const result = validate(config);
```

See `docs/08-schema-pipeline.md` before production use.

## Plugin options and scales

Options of a plugin under `options.plugins.<id>` are accepted unchecked, and a plugin scale type is an unknown variant (a warning). Describe them to have them checked:

```ts
import { s } from "@chartguard/config-core";
import { withExtensions } from "@chartguard/config-chartjs";

const validate = withExtensions([
  { id: "datalabels", options: { "chartjs.plugins": { datalabels: s.object({ anchor: s.string(["center", "start", "end"]) }) } } },
  { id: "streaming", variants: { "chartjs.scales": { realtime: s.object({ realtime: s.object({ duration: s.number() }) }) } } }
]);
validate(config).extensions; // ["datalabels", "streaming"]
```

An extension may not replace a built-in plugin or scale, and two extensions may not define the same name; either throws `ExtensionError` when the validator is built. A finding against an extension is as certain as the schema you gave it; mark a schema you are not sure of with `inferred: true` (`{ ...s.object({...}), inferred: true }`) and its findings are reported as likely problems (warnings), never as errors. Plugin chart types (controllers) cannot be described yet.

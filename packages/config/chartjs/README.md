# @chartguard/config-chartjs

Dependency-light validator for Chart.js, with a schema generated from the `chart.js@4.5.1` declarations and the runtime facts they leave out. Coverage is **partial**: see the limits below.

```ts
import { validate } from "@chartguard/config-chartjs";
const result = validate(config);
```

See `docs/08-schema-pipeline.md` before production use.

## Known limits

- **A scale without `type` is not checked.** Chart.js chooses its type from the chart type, the axis the scale id stands for and the datasets bound to it (`mergeScaleConfig`); that choice is not modelled yet, so such a scale is reported as `CFG_AMBIGUOUS` (info) and its options are not checked. Give the scale its `type` to have it checked (roadmap CG-02-09).

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

An extension may not replace a built-in plugin, scale or chart type, and two extensions may not define the same name; either throws `ExtensionError` when the validator is built, as does an extension of the wrong shape. A finding against an extension is as certain as the schema you gave it; mark a schema you are not sure of with `inferred: true` (`{ ...s.object({...}), inferred: true }`) and its findings are reported as likely problems (warnings), never as errors.

### Controllers

A plugin chart type (`Chart.register(FunnelController)`) is described by the built-in type it builds on; its chart config and its dataset both inherit from it, and an untyped dataset of the new chart type is checked as the new dataset type, as the runtime resolves it:

```ts
withExtensions([{ id: "funnel", controllers: { funnel: { extends: "bar", dataset: s.object({ shrinkFraction: s.number() }) } } }]);
```

The new type is the plugin's own: an option its `dataset` or `options` schema declares that the built-in also has is redefined for the new type only (a plugin dataset may read its `data` its own way); the built-in type keeps its own. The same holds for a scale that `extends` a built-in scale.


# @chartguard/config-chartjs

Dependency-light validator for Chart.js, with a schema generated from the `chart.js@4.5.1` declarations and the runtime facts they leave out. Coverage is **partial**: see the limits below.

```ts
import { validate } from "@chartguard/config-chartjs";
const result = validate(config);
```

A finding is as certain as the schema fact it rests on, and a clean result means no confirmed error was found, not that the configuration is complete: read `status` and `coverage`.

## Scale types

A scale without `type` is checked as the type Chart.js gives it (`mergeScaleConfig`): by the chart type's scale defaults for its axis or role (bar and line: the index axis `category`, the value axis `linear`, swapped by `indexAxis: 'y'`; scatter and bubble `linear`; radar and polar area `r` `radialLinear`), else by the defaults of the dataset types bound to it, else `radialLinear`, `category` or `linear` by its axis. The axis is the scale id (`x`, `y`, `r`), else its `position`, else the id's first letter. Every chart type takes every scale type, as the runtime looks a scale's type up in one registry.

## Known limits

- A scale without `type` stays inconclusive (`CFG_AMBIGUOUS`, info, its options unchecked) when the runtime's choice cannot be read without running code: a plugin chart type or dataset type (its controller's scale defaults are unknown), an `axis` option on an id that is not an axis, a scale only the datasets bound to it give an axis, a getter on the way, or a partial update (`incomplete: true`). The runtime's own defaults are assumed: a changed `Chart.overrides` or `Chart.defaults` is not modelled.

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
import { s } from "@chartguard/config-core";
import { withExtensions } from "@chartguard/config-chartjs";
withExtensions([{ id: "funnel", controllers: { funnel: { extends: "bar", dataset: s.object({ shrinkFraction: s.number() }) } } }]);
```

The new type is the plugin's own: an option its `dataset` or `options` schema declares that the built-in also has is redefined for the new type only (a plugin dataset may read its `data` its own way); the built-in type keeps its own. The same holds for a scale that `extends` a built-in scale.


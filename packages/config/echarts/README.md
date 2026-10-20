# @chartguard/config-echarts

Validator for Apache ECharts options, **generated** from the `echarts@6.1.0` TypeScript declarations (`EChartsOption`). Coverage is reported as `partial` until official examples pass against the runtime (CG-01-08).

```ts
import { validate } from '@chartguard/config-echarts';
const result = validate(option);
```

- Series types are an extensible registry: a type registered by an extension (`wordCloud`, `liquidFill`) is a warning, not an error.
- Components and series may be one object or an array of them.
- Options for components that `echarts/core` + `use([...])` did not register are not rejected; module-aware validation is CG-02-04.

The schema artifact is derived from Apache-2.0 licensed declarations; see `NOTICE`. See `docs/specs/CG-01-04-echarts-generator.md` for the contract adjustments and known limits.

## Extension components and series

Root components of an extension (`bmap`, echarts-gl's `globe`) are accepted unchecked, and an extension series is an unknown variant (a warning). Describe them to have them checked:

```ts
import { s } from '@chartguard/config-core';
import { withExtensions } from '@chartguard/config-echarts';

const validate = withExtensions([
	{ id: 'bmap', options: { 'echarts.options': { bmap: s.object({ zoom: s.number(), roam: s.boolean() }) } } },
	{ id: 'wordcloud', variants: { echarts: { 'series.wordCloud': s.object({ gridSize: s.number(), data: s.array(s.any()) }) } } }
]);
```

A variant schema is the whole series: options every series shares (`id`, `z`, …) are not inherited, so declare them or open the object (`s.object({...}, { additional: 'allow' })`). Built-ins cannot be replaced and a name has one owner; either throws `ExtensionError`. With a `registries` context, an extension series must be registered like any other. A schema marked `inferred: true` reports likely problems (warnings), never errors.

A variant may extend a built-in one instead of restating its options (`{ 'series.wordCloud': { extends: 'series.scatter', schema: s.object({ gridSize: s.number() }) } }`), and component subtypes are open the same way (`'dataZoom.wheel': { extends: 'dataZoom.inside' }`).

A deprecated option's finding links to where its migration is documented (`documentationUrl`, e.g. `…/option.html#series-pie.label.edgeDistance` for `label.margin`), only when the pinned documentation outline has that anchor.


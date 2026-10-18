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

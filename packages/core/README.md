# @chartguard/core

Shared diagnostics, statuses and runtime contracts.

Every ChartGuard package speaks the types defined here: a `Diagnostic` (code, severity, path, message, confidence, an optional fix), a `ValidationResult` (`valid`, `status`, `coverage`, the schema that checked it) and a `QualityReport`. You use it directly to apply a fix, to locate a finding in JSON text, or to stop a chart from being created with an invalid config.

**Status:** pre-release (0.x). Coverage is partial, and the API and settings may still change between minor versions.

```ts
import { Chart, type ChartConfiguration } from "chart.js";
import { createValidateBeforeCreate, locateJsonPath, parseJsonSource } from "@chartguard/core";
import { validate } from "@chartguard/config-chartjs";

// Creates the chart only when the config has no confirmed errors; otherwise throws
// ConfigValidationError, which carries the full result.
const validateBeforeCreate = createValidateBeforeCreate("chartjs", validate);
const chart = validateBeforeCreate(config, (checked) => new Chart(canvas, checked as ChartConfiguration));

// Where a finding is in the JSON text it came from (1-based line and column).
const text = '{ "type": "bar", "options": { "responsive": "yes" } }';
const parsed = parseJsonSource(text);
if (parsed.ok) {
	const { line, column } = locateJsonPath(parsed.root, "$.options.responsive");
	console.log(line, column);
}
```

- **Status and validity:** `valid` is true when nothing is a confirmed error; `status` is `valid`, `partial` (something could not be checked: an unknown schema part, a dynamic value) or `invalid`. Read `status` before trusting a `valid`.
- **Confidence:** `certain` findings rest on a schema fact from the library's own declarations; `inferred` on a derived or hand-written one (reported as warnings); `unknown` findings claim nothing.
- **Paths** use one notation everywhere: `$.series[0].type`, `$.title["te.xt"]`; `pathSegments` and `keySegment` read and write it.

## Fixes

A `Diagnostic` may carry a `fix`. There are two kinds:

- **`rename-key`** preserves behaviour: the runtime already reads the option under its new name, so a tool may apply it.
- **`set-option`** changes what is drawn, as a quality finding asks. It names the option (`path`), the value it held when the finding was made (`from`; absent when unset), the new `value` and its `effect`. Apply it only at the user's request.

`applyFix(config, fix, path?)` returns a new config with the fix applied. `path` is the finding's path, needed for a rename.

- Only the objects on the path are copied; everything else is shared.
- The input is never written and no getter runs.
- It throws `FixError` when the fix no longer applies: the option changed since the finding, a getter, a primitive or a missing array element is on the way, or a renamed key's new name is taken.

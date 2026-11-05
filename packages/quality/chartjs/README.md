# @chartguard/quality-chartjs

Advisory quality review of Chart.js configs: it reads the chart the config describes (what the runtime would draw, with its defaults) and reports presentation problems such as bars that do not start at zero, unreadable colours or charts assistive technology cannot describe. Findings are advice, never a verdict: there is no error severity and no `valid`.

**Status:** pre-release (0.x). Coverage is partial, and the API and settings may still change between minor versions.

```sh
npm install @chartguard/quality-chartjs
```

```ts
import { analyze } from "@chartguard/quality-chartjs";

const report = analyze({ type: "bar", data: { labels: ["a", "b"], datasets: [{ label: "Sales", data: [60, 70] }] }, options: { scales: { y: { min: 50 } } } });
for (const finding of report.diagnostics) console.log(finding.code, finding.path, finding.message, finding.fix);
```

- **Rules:** the shared catalog of `@chartguard/quality-core` (`RULE_CATALOG`: each rule with its rationale, sources and documented limits). `analyze(config, { rules: { "value-axis-untitled": "off" } })` sets a rule's level (`off`, `info`, `warning`); `ruleset` picks rules by id or impact.
- **Context:** facts the chart leaves to the page (`context: { background: "#ffffff" }`) let rules decide what the config alone cannot; a finding the context or a setting suppresses is kept in `report.suppressed`, with why.
- **Fixes:** a finding may carry a `set-option` fix, offered only when it is verified to remove the finding without a new one. It changes what is drawn: apply it (`applyFix` from `@chartguard/core`) only at the user's request.
- **Unknown stays unknown:** a fact the config does not decide (an option set by a callback, a size-dependent range) is unknown, and no rule claims anything on it.
- `normalize(config)` gives the library-neutral `ChartSemantics` the rules read; invalid options throw `QualityOptionsError` (`assertQualityOptions` checks them up front).

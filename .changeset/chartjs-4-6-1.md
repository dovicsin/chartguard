---
'@chartguard/config-chartjs': minor
'@chartguard/config-echarts': patch
'@chartguard/quality-chartjs': patch
'@chartguard/runtime-chartjs': minor
'@chartguard/schema-generator': patch
---

Chart.js 4.6.1, the latest release, is the supported version: the schema is generated from its declarations (new: `spacingMode` on arcs, a scriptable `tickWidth`, a scale title's `strokeColor` and `strokeWidth`; nothing narrowed), and every runtime default the quality review cites names its 4.6.1 line. `@chartguard/runtime-chartjs` now peers on `chart.js ^4.6.1`. Another Chart.js 4.x is still checked, with confirmed errors reported as warnings.

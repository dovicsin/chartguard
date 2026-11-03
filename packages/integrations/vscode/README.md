# ChartGuard for VS Code

Not published yet (CG-06-05). Chart.js, ECharts and Highcharts configs in JavaScript and TypeScript, checked as you type.

- **What is checked:** the configs a file hands to a chart library (`new Chart`, `setOption` on `echarts.init`, `Highcharts.chart`, the React wrappers, your own wrappers in `chartguard.patterns`), read without running anything.
- **Problems:** values the runtime rejects or misreads (errors), unknown keys, deprecations and values without effect (warnings), and the quality review's advice (information: it depends on context). Each stands at the value it is about.
- **Quick fixes:** the runtime's own renames (`clockWise` → `clockwise`) where the edit cannot change anything else. An edit that changes the drawing (bars that do not start at zero) is offered too, never preferred, and VS Code shows it for confirmation first.
- **Settings** (`chartguard.*`): `libraryVersion` (exact versions, or `"auto"` for the version installed for each file), `registries`, `extensions` (plugin schemas), `patterns`, `quality` (rule levels, ignores, page context), `project` (read files through their imports with the project's tsconfig). Settings that cannot be used are shown once; nothing is claimed until they are fixed. **ChartGuard: Restart the language server** restarts it.
- **Workspace trust:** in a workspace you have not trusted, every `chartguard.*` setting is read from your user settings only.
- **How it runs:** the extension starts ChartGuard's language server (`@chartguard/language-server`, bundled) in its own process. The licences of everything bundled are in `dist/THIRD-PARTY-NOTICES.txt`.
- **Highcharts:** the full schema cannot ship (licence); build it in your project with `chartguard schema build --library highcharts` and it is used for exactly that version. Otherwise the curated subset (partial) is used.

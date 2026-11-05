# @chartguard/language-server

A language server over stdio: `chartguard-language-server --stdio`.

**Status:** pre-release (0.x). Coverage is partial, and the API and settings may still change between minor versions.

- Checks JavaScript and TypeScript documents (`javascript`, `javascriptreact`, `typescript`, `typescriptreact`) as they open and change (incremental text sync: each change applied at LSP positions, a batch in one pass over the text in the orders editors send it; one that cannot be applied, or a batch in no order that would take too many passes, withdraws the document's findings until it is opened again), with `@chartguard/source-checks`: the configs a document hands to Chart.js, ECharts or Highcharts, read without running anything.
- Diagnostics: validator errors (Error), warnings (Warning) and quality findings (Information, advisory), each at the range that wrote its value, source `ChartGuard`, code the kind (`valid-config`, `config-warnings`, `chart-quality`).
- Code actions: the runtime's own renames as preferred quick fixes; an edit that changes the drawing as a quick fix that is never preferred and, where the client supports change annotations, asks for confirmation (VS Code shows a preview).
- Settings: `initializationOptions.settings.chartguard` and `workspace/didChangeConfiguration` (`settings.chartguard`), the same keys as the ESLint plugin's `settings.chartguard` (`libraryVersion`, `registries`, `extensions`, `patterns`, `quality`, `project`). Settings that cannot be used are shown once and nothing is claimed until they are fixed.
- Paths: the workspace root (`workspaceFolders[0]` or `rootUri`) is where relative settings and other files are named from; an unsaved document is read under its name in the workspace with its language's extension.
- The protocol is bounded: a message over 32 MiB or without a length ends the connection with the reason logged.

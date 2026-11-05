# Editors

**Status:** pre-release (0.x). Settings and findings may still change between minor versions.

Both read the configs a file hands to Chart.js, ECharts or Highcharts, without running anything, and
report each finding at the range that wrote its value. They share one checker, so they report the
same findings.

## ESLint 9

```js
// eslint.config.js
import chartguard from '@chartguard/eslint-plugin';

export default [chartguard.configs.recommended];
```

The plugin has three rules:

- `chartguard/valid-config` reports what the validator confirms is wrong.
- `chartguard/config-warnings` reports unknown keys, deprecations and values that have no effect.
  `eslint --fix` applies the runtime's own renames, and only where the edit cannot change anything
  else.
- `chartguard/chart-quality` reports the quality review's advice. Its edits change the drawing, so
  they are offered as suggestions and never applied by `--fix`.

Each rule's documentation link opens the [codes](../codes.html) or [quality rules](../rules.html)
page.

Settings go under `settings.chartguard`:

- `libraryVersion`: an exact version, or `"auto"` to use what the project installs;
- `registries`: what a tree-shaken runtime registered;
- `extensions`: schemas for plugin options;
- `patterns`: your own chart wrappers;
- `quality`: rule levels, ignores and page context;
- `project`: read each file through its imports with its tsconfig.

## VS Code

The extension starts ChartGuard's language server and shows findings in the Problems view:

- validator errors as errors, warnings as warnings;
- the quality review's advice as information.

A finding's code links to its explanation. Quick fixes apply the runtime's own renames. An edit that
changes the drawing is offered too, but never preferred, and VS Code asks before applying it.

Settings are the `chartguard.*` keys, which match the ESLint settings above. In a workspace you have
not trusted, they are read from your user settings only.

## Other editors

Any editor with a Language Server Protocol client can run `chartguard-language-server --stdio` from
`@chartguard/language-server`. It checks `javascript`, `javascriptreact`, `typescript` and
`typescriptreact` documents. It reads its settings from `initializationOptions.settings.chartguard`
and from `workspace/didChangeConfiguration`.

## Highcharts

The full Highcharts schema cannot ship with ChartGuard because of Highcharts' licence. Build it in
your project:

```sh
npx chartguard schema build --library highcharts
```

The editors then use it for exactly the version you installed. Without it, they check against a
curated subset, and the result is partial.

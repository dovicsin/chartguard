# @chartguard/source-checks

Not published (CG-06-04). The chart config checks of JavaScript and TypeScript source that `@chartguard/eslint-plugin` and the language server share: `new SourceChecker(settings, prefix).check(text, fileName, cwd)` returns each finding (`valid-config`, `config-warnings`, `chart-quality`) with its offsets in the text, the runtime's own renames as fixes and verified quality edits as suggestions. The settings are those of `settings.chartguard` in the ESLint plugin's README.

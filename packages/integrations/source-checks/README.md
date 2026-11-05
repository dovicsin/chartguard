# @chartguard/source-checks

The chart config checks of JavaScript and TypeScript source that `@chartguard/eslint-plugin` and the language server share: `new SourceChecker(settings, prefix).check(text, fileName, cwd)` returns each finding (`valid-config`, `config-warnings`, `chart-quality`) with its offsets in the text, the runtime's own renames as fixes and verified quality edits as suggestions. The settings are those of `settings.chartguard` in the ESLint plugin's README.

**Status:** pre-release (0.x). Coverage is partial, and the API and settings may still change between minor versions.

```sh
npm install --save-dev @chartguard/source-checks
```

`@chartguard/source-checks/text` runs without Node (the playground, CG-06-06 part 3): `checkText(text, fileName, engine)` reads one text alone and returns `{ readable, uses, findings }`, the same findings `SourceChecker` gives for that file; `engine` validates and reviews each library's configs (no settings, no install, no built schema).

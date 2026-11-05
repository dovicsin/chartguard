# Continuous integration

**Status:** pre-release (0.x). A minor version may still change the API, so pin exact versions when you install.

## Any CI: the command line

```sh
npx chartguard validate --library chartjs --file "charts/**/*.json" --fail-on error
npx chartguard analyze --library echarts --project tsconfig.json
```

`--fail-on` decides what fails the build:

- `error` (the default): confirmed errors only;
- `warning`: warnings too;
- `never`: nothing fails.

The quality review is advisory, so `chartguard quality` fails nothing unless you set
`--fail-on warning`.

The exit code tells you what happened:

- `1`: findings that fail;
- `2`: your input or invocation is unusable;
- `3`: a ChartGuard defect, so please report it.

For other tools, change the output with `--format json` or `--format sarif`. `--cache` reuses a
file's result while nothing it depends on has changed.

Settings can live in `chartguard.config.json` in the working directory, so the command line stays
short:

```json
{
	"library": "chartjs",
	"files": ["charts/**/*.json"],
	"libraryVersion": "auto",
	"failOn": "error"
}
```

## GitHub Actions

The repository is also a composite action. Each finding becomes an annotation on the line that
wrote its value. Optionally, it also writes a SARIF log for code scanning:

```yaml
name: chartguard
on: [push, pull_request]
permissions:
  contents: read
jobs:
  charts:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
      security-events: write # only for the SARIF upload
    steps:
      - uses: actions/checkout@v5
      - uses: dovicsin/chartguard@v0.1.1 # a release tag, never moved
        with:
          command: validate
          library: chartjs
          files: |
            charts/**/*.json
          fail-on: error
          sarif-file: chartguard.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: chartguard.sarif
          category: chartguard
```

The action takes these inputs:

- `command`: `validate`, `analyze` or `quality`;
- `library`;
- `files` and `ignore`: one pattern per line;
- `config`;
- `project`: for `analyze`;
- `library-version`;
- `fail-on`;
- `sarif-file`;
- `node-version`.

It sets the `exit-code` output to the CLI's exit code. In SARIF, each rule's help links to its code
on the [codes page](../codes.html).

## What a clean run means

A run with no findings means no confirmed error was found in what ChartGuard could read. Coverage is
partial: an option the schema does not know is reported as a warning, never silently accepted as
correct. A value built at runtime is unknown and is never claimed to be wrong.

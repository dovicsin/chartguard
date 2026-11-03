# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** (Security → Advisories) on this repository, not in a public issue. You will get an answer as soon as possible; this is a project maintained by one person, so allow a few days.

## What is in scope

- Static source analysis that executes, imports or evaluates any part of the analysed code, or reads files a tsconfig does not name.
- Input (a config, a source file, a project) that crashes ChartGuard, hangs it, or makes it use unbounded memory instead of being refused with a note.
- A validator result that claims a config is valid or complete when it read part of it from code it could not resolve.
- Anything in a published `@chartguard/*` package that reaches the network or writes files without being asked to.
- A plugin schema or a quality settings file that crashes ChartGuard or makes it claim errors instead of being refused as a setup error.
- The playground: anything typed or linked into the page that runs as code in the page itself, a shared link that hangs it or exhausts its memory, and code run in the drawing sandbox (on request) that reaches the page, its storage or the network.
- The GitHub Action and `--format github`: a config, a file name or an input that runs a command or injects a workflow command.
- The language server and the VS Code extension: a message or document that crashes the server, or a workspace setting that takes effect in a workspace you have not trusted.

## Supported versions

ChartGuard has not reached 1.0. Fixes go to the latest release and to `main`.

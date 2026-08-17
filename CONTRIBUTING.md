# Contributing to DeskCue

By participating in this project, you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

Report potential vulnerabilities privately according to the
[Security Policy](SECURITY.md).

DeskCue is a local-first public alpha. Changes should preserve the main loop:
start or resume a local agent, follow its work, review the diff and Preview, and
send the next instruction from the dashboard.

## Development Setup

Requirements:

- Node.js 22.22 or newer within the 22.x release line, or Node.js 24.x
- npm 10+
- Git

Install dependencies:

```bash
npm install
```

Start the development setup:

```bash
npm run dev
```

## Before a Pull Request

Use focused checks while you work. Before opening a pull request, run the full
repository check from the root:

```bash
npm run verify
```

`verify` runs package contracts, daemon lint/typecheck/build/tests, CLI
tests/typecheck/build, web release tests and builds, dependency audits, and
`git diff --check`. The steps run sequentially so workspace clean/build scripts
do not race over shared `dist` output.

Do not commit local runtime data:

- `.deskcue-data/`
- `*.log`
- `.env`
- local database backups

## Code Guidelines

- Keep the local experience local-first and self-hostable
- Cloud, billing, teams, SSO, or a hosted relay must not become requirements for
  the local path
- Reuse `@deskcue/protocol` for API payloads and event shapes
- Keep `@deskcue/protocol` as a dependency leaf; applications should not import
  each other's implementation
- Keep daemon transport, application services, persistence, and runtime adapters
  separate
- Import leaf modules instead of routing internal dependencies back through a
  runtime barrel. Avoid runtime cycles; type-only domain relationships are fine
  when they do not create runtime coupling
- When a class or hook starts owning unrelated cache, persistence, transport,
  and lifecycle state, split those responsibilities behind a small facade
- Add focused tests when a change affects process control, migrations, access
  control, realtime behavior, or persistence

## Documentation

Repository docs must be self-contained and must not depend on private planning
files outside the repository.

- Omit terminal periods from short list items and table cells
- Keep normal punctuation in prose and multi-sentence list items

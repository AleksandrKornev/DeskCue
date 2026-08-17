# Examples

These examples are meant for source-checkout development and first-run smoke
testing.

## Generic CLI Demo Agent

From the repository root:

```bash
npm run dev
```

Open the dashboard, register this repository as a workspace, then start a
generic command:

```bash
node examples/generic-echo-agent.cjs
```

The demo prints a ready line, waits for input, echoes each instruction and exits
when it receives `exit`.

## Codex

DeskCue discovers local Codex sessions from the user's Codex metadata and can
resume resumable sessions with `codex resume`.

Use your normal Codex installation and account. DeskCue does not manage Codex
credentials.

## Claude Code

DeskCue discovers Claude Code sessions from the local Claude configuration and
can attach back with `claude --resume` when the source chat is resumable.

Use your normal Claude Code installation and account. DeskCue does not manage
Claude credentials.

## LAN Pairing

Use `GET /api/access/link` from the host machine and open the returned `webUrl`
from the target browser or device. See [Installation](./installation.md).

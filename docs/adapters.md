# Agent Adapters

Generic CLI is DeskCue's baseline: if a tool can run in a local workspace PTY,
DeskCue can start it without knowing anything about that tool. Runtime-specific
adapters add the pieces that need deeper integration, such as session discovery,
transcript parsing, attach, and resume.

Adding a runtime should normally stay inside those adapter boundaries. Core
session, storage, HTTP, and WebSocket contracts only need to change when the
user-facing protocol really needs something new.

## Current Support Levels

| Runtime | Runtime kind | Support level | Behavior |
| --- | --- | --- | --- |
| Generic CLI | `generic-cli` | Stable local path | Starts any command in a workspace PTY, streams logs, accepts stdin, tracks git state and preview port |
| Codex | `agent-cli` | Experimental attach/resume | Discovers local sessions, parses transcripts, resumes chats with `codex resume`, and avoids opening a second writer when a thread is active elsewhere |
| Claude Code | `agent-cli` | Experimental attach/resume | Discovers local sessions and resumes compatible chats with `claude --resume` |
| Ollama | `llm-runtime` | Experimental local chat | Runs DeskCue-owned chats through the local Ollama API |
| LM Studio | `llm-runtime` | Experimental local chat | Runs DeskCue-owned chats through the local LM Studio API |
| OpenCode / OpenHands | `agent-cli` | Planned | Metadata is reserved. Start with Generic CLI until discovery and resume support are implemented |
| vLLM | `llm-runtime` | Planned | Metadata is reserved for local runtime status, model context, and future transcript/provider context. DeskCue does not host models |
| LiteLLM / OpenRouter | `provider-gateway` | Planned | Metadata is reserved for configuration visibility. DeskCue should not store provider secrets by default |

## Runtime Kinds

- `generic-cli` is the fallback for any command that can run in a local
  workspace PTY
- `agent-cli` is for coding agents that own resumable chats or command sessions,
  such as Codex and Claude Code
- `llm-runtime` covers local model runtimes and desktop apps such as LM Studio,
  Ollama, and vLLM. DeskCue-owned chats use their local HTTP APIs and stay
  separate from discovered agent transcripts
- `provider-gateway` covers routers such as LiteLLM or OpenRouter. For now this
  means configuration/runtime visibility unless a future adapter adds a safe
  user-owned prompt path

## Adapter Boundary

These are the main ownership boundaries when adding or changing runtime support:

- `packages/adapters` owns adapter ids, labels, generic launch normalization,
  support levels, capability metadata, and runtime resume helpers shared by the
  daemon and dashboard
- `packages/protocol` owns API-visible source ids, transcript shapes, attach
  modes, and session DTO fields
- `apps/daemon/src/agents/<runtime>` owns local discovery, transcript parsing,
  runtime metadata extraction, and runtime-specific command construction
- `apps/daemon/src/agents/sourceAgentRegistry.ts` declares source-agent
  descriptors for runtimes that can appear in `/api/agents/sessions`
- `apps/daemon/src/agents/sourceAgentSessions.ts` runs those descriptors and
  keeps public discovery/detail behavior ordered and consistent
- `apps/daemon/src/sessions/attach/sessionAttachOrchestration.ts` decides how a
  discovered source session becomes managed or read-only
- `apps/daemon/src/backend/control/sourcePromptTransportStrategy.ts` owns the
  source-agent prompt transport registry, including per-runtime queue policy
  and transport startup
- `apps/daemon/src/agents/control/externalProcess/sourceAgentExternalProcessControlRegistry.ts`
  registers optional runtime-specific force-stop capabilities
- `apps/daemon/src/localLlmChats/generation/transport/localLlmRuntimeAdapterRegistry.ts`
  composes local HTTP runtime adapters and keeps endpoint, wire-format, and
  tool-capability behavior out of the chat service

Daemon application services should depend on source-agent and session ports
instead of importing runtime internals directly.

## Adding a Runtime

1. Add the adapter id, label, runtime kind, support level, and capabilities in
   `packages/adapters`. Add a resume helper only when the runtime has a safe
   attach or resume command. Keep `adapterMetadata` current so daemon and web
   code do not need separate support tables
2. Add or extend protocol enums and DTOs only when the dashboard or API clients
   need a new visible value
3. Add discovery and transcript parsing under `apps/daemon/src/agents/<runtime>`.
   Keep filesystem paths, CLI probes, and parser quirks local to that folder
4. For an `agent-cli`, add a descriptor to `sourceAgentRegistry.ts` so the
   runtime appears in `/api/agents/sessions`
5. If a discovered session can be attached or resumed, add a strategy to the
   source-agent attach map in `sessionAttachOrchestration.ts`
6. If an attached source session accepts follow-up prompts, add its transport
   and queue policy to `sourcePromptTransportStrategy.ts`. Only register a
   writable path when the runtime contract supports it
7. If DeskCue can force-stop a runtime process it did not launch, register an
   identity-checked descriptor in
   `sourceAgentExternalProcessControlRegistry.ts`
8. For an `llm-runtime`, implement the `LocalLlmRuntimeAdapter` boundary and
   register it in `localLlmRuntimeAdapterRegistry.ts`; keep provider wire
   formats and endpoint behavior out of the chat service
9. Add fixtures and tests for the discovery, transcript, transport,
   process-control, wire-codec, and attach behavior you changed
10. Update `docs/examples.md`, this document, and the release checklist when
    the support level changes

## Runtime Rules

- Generic CLI must keep working even when every runtime-specific probe fails
- Discovery should be best-effort. A missing CLI, unreadable config file, or
  malformed transcript should skip that runtime or entry rather than fail the
  whole dashboard
- Runtime credentials stay with the runtime. DeskCue does not collect API keys,
  account tokens, model credentials, or hosted provider secrets
- Resume commands must preserve the user's selected workspace and should avoid
  shell string parsing when the daemon can provide a direct spawn spec
- Runtime-specific logs should avoid raw tokens, long environment dumps, and
  full private transcript paths unless the path is already part of a local
  troubleshooting flow
- If a runtime allows only one active writer for a chat, DeskCue must represent
  that with `read_only` or the runtime's own resume path instead of starting a
  competing writer

## Tests and Smoke

Adapter work should usually run:

```bash
npm run build --workspace @deskcue/protocol
npm run typecheck --workspace @deskcue/protocol
npm run build --workspace @deskcue/adapters
npm run typecheck --workspace @deskcue/adapters
npm run typecheck --workspace @deskcue/daemon
npm run test --workspace @deskcue/daemon
```

If the dashboard behavior changes, also run:

```bash
npm run typecheck --workspace @deskcue/web
npm run lint --workspace @deskcue/web
```

For a source-checkout release, finish with the smoke commands in the release
checklist.

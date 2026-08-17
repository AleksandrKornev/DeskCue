import assert from "node:assert/strict";
import test from "node:test";

import type { SessionDetail } from "@deskcue/protocol";
import type { SourceAgentExternalProcessControlDescriptor } from "#agents/control/externalProcess/sourceAgentExternalProcessControlRegistry";
import type { SourceTurnInterruptTarget } from "#agents/sourceTurnInterruptLifecycle";
import { emptyPreview, emptyReplyState } from "#sessions/model/sessionDefaults";

import {
  ExternalAgentSessionControl,
  externalAgentSessionRuntime
} from "./externalAgentSessionControl.ts";
import type { ExternalAgentSessionRuntime } from "./externalAgentSessionControl.ts";

function sessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    adapterId: "codex",
    sourceSessionId: "source-1",
    command: "codex resume source-1",
    status: "stopped",
    startedAt: "2026-08-05T08:00:00.000Z",
    finishedAt: "2026-08-05T08:02:00.000Z",
    lastActivityAt: "2026-08-05T08:02:00.000Z",
    exitCode: null,
    preview: emptyPreview(),
    replyState: emptyReplyState(),
    git: {
      branch: "main",
      changedFiles: [],
      diff: "",
      isDirty: false,
      isGitRepo: true,
      lastUpdatedAt: "2026-08-05T08:00:00.000Z"
    },
    logs: [],
    inputHistory: [],
    ...overrides
  };
}

function processControlDescriptor(
  adapterId: string,
  agentLabel: string,
  requestForceStop: SourceAgentExternalProcessControlDescriptor["requestForceStop"]
): SourceAgentExternalProcessControlDescriptor {
  return {
    adapterId,
    agentLabel,
    getForceStopCapability: async () => ({ kind: "unavailable", reason: "test" }),
    requestForceStop
  };
}

test("resolves an external force-stop capability through the adapter registry", async () => {
  const session = sessionDetail({ adapterId: "source-agent" });
  const resolvedAdapterIds: string[] = [];
  const runtime: ExternalAgentSessionRuntime = {
    ...externalAgentSessionRuntime,
    getSourceAgentExternalProcessControl(adapterId) {
      resolvedAdapterIds.push(adapterId);
      return {
        adapterId,
        agentLabel: "Source Agent",
        getForceStopCapability: async (sourceSessionId) => ({
          kind: "available",
          processId: sourceSessionId.length,
          processCreatedAt: "2026-08-05T08:00:00.000Z"
        }),
        requestForceStop: async () => ({ kind: "process_identity_changed" })
      };
    }
  };
  const control = new ExternalAgentSessionControl({
    appendSystemLog: () => {},
    getSession: () => session,
    hasManagedChild: () => false,
    openCodexDesktopThread: async () => {},
    persistState: async () => {},
    runtime,
    sourceTurnInterrupts: {} as never,
    updateSession: () => {}
  });

  assert.deepEqual(await control.getForceStopCapability(session.id), {
    kind: "available",
    processId: "source-1".length,
    processCreatedAt: "2026-08-05T08:00:00.000Z"
  });
  assert.deepEqual(resolvedAdapterIds, ["source-agent"]);
});

test("force stops a verified external Codex process before recording the interrupt lifecycle", async () => {
  const session = sessionDetail();
  const lifecycle: string[] = [];
  const runtime: ExternalAgentSessionRuntime = {
    ...externalAgentSessionRuntime,
    getSourceAgentExternalProcessControl: () => processControlDescriptor(
      "codex",
      "Codex",
      async (sourceSessionId, target) => {
        lifecycle.push(
          `stop:${sourceSessionId}:${target.processId}:${target.processCreatedAt}`
        );
        return { kind: "stop_requested", processId: 42 };
      }
    )
  };
  const control = new ExternalAgentSessionControl({
    appendSystemLog: (_sessionId, text) => lifecycle.push(`log:${text.trim()}`),
    getSession: () => session,
    hasManagedChild: () => false,
    openCodexDesktopThread: async () => {},
    persistState: async () => {
      lifecycle.push("persist");
    },
    runtime,
    sourceTurnInterrupts: {
      requestExternalForceStop: (
        _session: SessionDetail,
        target?: SourceTurnInterruptTarget | null
      ) => {
        lifecycle.push(`interrupt:${target?.fingerprint}`);
      }
    } as never,
    updateSession: () => {}
  });

  const result = await control.forceStopProcess(
    session.id,
    { processId: 42, processCreatedAt: "2026-08-05T08:00:00.000Z" },
    { fingerprint: "turn-1", startedAt: "2026-08-05T08:01:00.000Z" }
  );

  assert.equal(result, session);
  assert.deepEqual(lifecycle, [
    "stop:source-1:42:2026-08-05T08:00:00.000Z",
    "interrupt:turn-1",
    "log:Force stop requested for external Codex process 42. Waiting for source confirmation.",
    "persist"
  ]);
});

test("releases a stopped external Claude session for a seamless managed follow-up", async () => {
  let session = sessionDetail({
    adapterId: "claude-code",
    command: "claude --resume source-1 (observe-only)"
  });
  const lifecycle: string[] = [];
  const runtime: ExternalAgentSessionRuntime = {
    ...externalAgentSessionRuntime,
    canTakeOverStoppedExternalClaudeSession: async () => true,
    getSourceAgentExternalProcessControl: () => processControlDescriptor(
      "claude-code",
      "Claude Code",
      async () => ({ kind: "stop_requested", processId: 84 })
    ),
    resolveClaudeBackgroundControlCapability: async (sourceSessionId) => ({
      kind: "observe_only",
      sourceSessionId,
      reason: "interactive_session"
    })
  };
  const control = new ExternalAgentSessionControl({
    appendSystemLog: (_sessionId, text) => lifecycle.push(`log:${text.trim()}`),
    getSession: () => session,
    hasManagedChild: () => false,
    openCodexDesktopThread: async () => {},
    persistState: async () => {
      lifecycle.push("persist");
    },
    runtime,
    sourceTurnInterrupts: {
      requestExternalForceStop: () => lifecycle.push("interrupt")
    } as never,
    updateSession: (_sessionId, patch) => {
      lifecycle.push(`update:${patch.command}`);
      session = { ...session, ...patch };
    }
  });

  const result = await control.forceStopProcess(session.id, {
    processId: 84,
    processCreatedAt: "2026-08-05T08:00:00.000Z"
  });

  assert.equal(result.command, "claude --resume source-1 (read-only)");
  assert.deepEqual(lifecycle, [
    "update:claude --resume source-1 (read-only)",
    "interrupt",
    "log:External Claude Code process 84 stopped. DeskCue can now resume this chat.",
    "persist"
  ]);
});

test("does not force stop Claude's worker when a verified background stop exists", async () => {
  const session = sessionDetail({ adapterId: "claude-code" });
  let processStopRequested = false;
  const control = new ExternalAgentSessionControl({
    appendSystemLog: () => {},
    getSession: () => session,
    hasManagedChild: () => false,
    openCodexDesktopThread: async () => {},
    persistState: async () => {},
    runtime: {
      ...externalAgentSessionRuntime,
      getSourceAgentExternalProcessControl: () => processControlDescriptor(
        "claude-code",
        "Claude Code",
        async () => {
          processStopRequested = true;
          return { kind: "stop_requested", processId: 84 };
        }
      ),
      resolveClaudeBackgroundControlCapability: async (sourceSessionId) => ({
        kind: "claude_background_stop",
        sourceSessionId,
        jobId: "job-1",
        state: "working",
        pid: 84
      })
    },
    sourceTurnInterrupts: {} as never,
    updateSession: () => {}
  });

  await assert.rejects(
    control.forceStopProcess(session.id, {
      processId: 84,
      processCreatedAt: "2026-08-05T08:00:00.000Z"
    }),
    /Use the verified Claude Code background stop command/
  );
  assert.equal(processStopRequested, false);
});

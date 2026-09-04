import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { AgentSessionSummary, LocalLlmChatSummary, SessionSummary } from "@deskcue/protocol";

import {
  readCloudSessionProjection,
  resolveCloudSessionRoute
} from "./cloudSessionProjection.ts";

const INSTALLATION_ID = "installation-projection-test";
const VALID_TIMESTAMP = "2026-08-11T03:00:00.000Z";

function projectionSource({
  local = [],
  managed = [],
  source = []
}: {
  local?: LocalLlmChatSummary[];
  managed?: SessionSummary[];
  source?: AgentSessionSummary[];
} = {}) {
  return {
    listLocalLlmChats: async () => local,
    listManagedSessions: () => managed,
    listSourceSessions: async () => source
  };
}

function managedSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "managed-default",
    workspaceId: "workspace-private-id",
    workspaceName: "Private workspace",
    adapterId: "codex",
    sourceSessionId: null,
    command: "private-command",
    status: "done",
    startedAt: VALID_TIMESTAMP,
    finishedAt: VALID_TIMESTAMP,
    lastActivityAt: VALID_TIMESTAMP,
    exitCode: 0,
    preview: { active: false, networkMode: "device-direct", port: null, targetUrl: null },
    replyState: { phase: "idle", promptText: "private prompt", requestedAt: null },
    actionRequest: null,
    git: {
      isGitRepo: true,
      branch: "private-branch",
      isDirty: true,
      changedFiles: ["private-file.ts"],
      diff: "private diff",
      lastUpdatedAt: VALID_TIMESTAMP
    },
    ...overrides
  };
}

function sourceSession(overrides: Partial<AgentSessionSummary> = {}): AgentSessionSummary {
  return {
    id: "source-default",
    agentId: "codex",
    agentLabel: "Private agent label",
    sourceSessionId: "source-default",
    title: "Private source title",
    workspacePath: "D:\\private\\workspace",
    workspaceName: "Private workspace",
    updatedAt: VALID_TIMESTAMP,
    model: "private-model",
    originator: "private-originator",
    cliVersion: "private-version",
    source: "private-source",
    filePath: "D:\\private\\session.jsonl",
    attachMode: "resume",
    workState: "idle",
    ...overrides
  };
}

function localChat(overrides: Partial<LocalLlmChatSummary> = {}): LocalLlmChatSummary {
  return {
    id: "local-default",
    title: "Private local title",
    runtimeId: "ollama",
    model: "private-local-model",
    workspace: { id: "private-workspace", name: "Private", path: "D:\\private" },
    createdAt: VALID_TIMESTAMP,
    updatedAt: VALID_TIMESTAMP,
    generationState: "idle",
    generationError: "private-error",
    agentMode: "full_access",
    toolCapability: null,
    ...overrides
  };
}

function opaqueId(installationId: string, kind: string, localId: string) {
  return `sess_${createHash("sha256")
    .update(installationId)
    .update("\0")
    .update(kind)
    .update("\0")
    .update(localId)
    .digest("hex")}`;
}

test("cloud session projection is metadata-only, stable, opaque, deduplicated, and skips invalid timestamps", async () => {
  const managedSource = managedSession({
    id: "private-managed-id",
    sourceSessionId: "shared-source-id",
    workspaceName: "Private workspace name",
    command: "private command --with-secret",
    lastActivityAt: "2026-08-11T03:04:05.678Z",
    status: "done"
  });
  const duplicateSource = sourceSession({
    id: "private-source-row-id",
    sourceSessionId: "shared-source-id",
    title: "Private source title",
    workspacePath: "D:\\private\\workspace",
    updatedAt: "2026-08-11T03:05:00.000Z",
    workState: "running"
  });
  const input = projectionSource({
    managed: [
      managedSource,
      managedSession({ id: "invalid-managed", lastActivityAt: "not-a-date" })
    ],
    source: [
      duplicateSource,
      sourceSession({ id: "invalid-source", sourceSessionId: "invalid", updatedAt: "invalid" })
    ],
    local: [
      localChat({ id: "private-local-id", title: "Private local title" }),
      localChat({ id: "invalid-local", updatedAt: "invalid" })
    ]
  });

  const first = await readCloudSessionProjection(INSTALLATION_ID, input);
  const second = await readCloudSessionProjection(INSTALLATION_ID, input);
  const otherInstallation = await readCloudSessionProjection("other-installation", input);

  assert.equal(first.length, 2);
  assert.deepEqual(first, second);
  assert.notEqual(first[0]?.sessionId, otherInstallation[0]?.sessionId);
  assert.equal(first[0]?.sessionId, opaqueId(INSTALLATION_ID, "source", "codex:shared-source-id"));
  assert.match(first[0]?.sessionId ?? "", /^sess_[a-f0-9]{64}$/);
  assert.deepEqual(first[0], {
    sessionId: opaqueId(INSTALLATION_ID, "source", "codex:shared-source-id"),
    runtime: "codex",
    status: "done",
    replyState: "idle",
    updatedAt: "2026-08-11T03:04:05.678Z",
    disclosureScope: "metadata_only"
  });
  for (const projection of first) {
    assert.deepEqual(Object.keys(projection).sort(), [
      "disclosureScope",
      "replyState",
      "runtime",
      "sessionId",
      "status",
      "updatedAt"
    ]);
  }

  const serialized = JSON.stringify(first);

  for (const privateValue of [
    "private-managed-id",
    "shared-source-id",
    "Private workspace name",
    "private command --with-secret",
    "private-source-row-id",
    "Private source title",
    "D:\\private\\workspace",
    "private-local-id",
    "Private local title"
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("cloud session route resolution preserves projection precedence without exposing local ids", async () => {
  const input = projectionSource({
    managed: [managedSession({ id: "managed-route", sourceSessionId: "shared-source" })],
    source: [
      sourceSession({ id: "codex:shared-source", sourceSessionId: "shared-source" }),
      sourceSession({ id: "claude-code:source-route", agentId: "claude-code", sourceSessionId: "source-route" })
    ],
    local: [localChat({ id: "local-route" })]
  });

  assert.deepEqual(
    await resolveCloudSessionRoute(
      INSTALLATION_ID,
      input,
      opaqueId(INSTALLATION_ID, "source", "codex:shared-source")
    ),
    { kind: "managed", sessionId: "managed-route" }
  );

  assert.deepEqual(
    await resolveCloudSessionRoute(
      INSTALLATION_ID,
      input,
      opaqueId(INSTALLATION_ID, "source", "claude-code:source-route")
    ),
    { kind: "agent", sessionId: "claude-code:source-route" }
  );

  assert.deepEqual(
    await resolveCloudSessionRoute(
      INSTALLATION_ID,
      input,
      opaqueId(INSTALLATION_ID, "local", "local-route")
    ),
    { kind: "local_llm", sessionId: "local-route" }
  );

  assert.equal(
    await resolveCloudSessionRoute(INSTALLATION_ID, input, `sess_${"f".repeat(64)}`),
    null
  );
});

test("cloud session projection shares only bounded labels after explicit opt-in", async () => {
  const longTitle = `  ${"x".repeat(200)}  `;
  const projections = await readCloudSessionProjection(
    INSTALLATION_ID,
    projectionSource({
      managed: [managedSession({
        id: "managed-source",
        adapterId: "codex",
        sourceSessionId: "source-label",
        workspaceName: "D:\\private\\ignored"
      })],
      source: [sourceSession({
        sourceSessionId: "source-label",
        title: "\u202e  Fix   mobile\nlayout  ",
        workspaceName: "D:\\private\\DeskCue"
      }), sourceSession({
        agentId: "claude-code",
        sourceSessionId: "source-fallback",
        title: "Claude session deadbeef",
        workspaceName: null
      })],
      local: [localChat({
        id: "local-long",
        title: longTitle,
        workspace: { id: "workspace", name: "/private/Local project", path: "/private/Local project" }
      })]
    }),
    { includeLabels: true }
  );

  const managed = projections.find((projection) => projection.runtime === "codex");
  const local = projections.find((projection) => projection.runtime === "ollama");

  assert.deepEqual(managed, {
    sessionId: opaqueId(INSTALLATION_ID, "source", "codex:source-label"),
    runtime: "codex",
    status: "done",
    replyState: "idle",
    updatedAt: VALID_TIMESTAMP,
    disclosureScope: "user_opt_in",
    displayLabel: "Fix mobile layout",
    workspaceLabel: "DeskCue"
  });

  assert.equal(local?.disclosureScope, "user_opt_in");
  assert.equal(local?.displayLabel?.length, 160);
  assert.equal(local?.workspaceLabel, "Local project");
  const fallback = projections.find((projection) => projection.runtime === "claude_code");

  assert.equal(fallback?.displayLabel, undefined);

  assert.equal(fallback?.disclosureScope, "user_opt_in");
  const serialized = JSON.stringify(projections);

  assert.equal(serialized.includes("D:\\private"), false);

  assert.equal(serialized.includes("/private/"), false);
  assert.equal(serialized.includes("private prompt"), false);
});

test("cloud session projection preserves the safe subagent role without label disclosure", async () => {
  const subagentSource = sourceSession({
    sourceSessionId: "subagent-source",
    source: "codex",
    subagent: {
      depth: 1,
      nickname: "private nickname",
      parentSessionId: "codex:private-parent-id",
      role: "private role"
    }
  });
  const projections = await readCloudSessionProjection(INSTALLATION_ID, projectionSource({
    managed: [managedSession({ sourceSessionId: "subagent-source" })],
    source: [subagentSource, sourceSession({ sourceSessionId: "primary-source" })]
  }));

  const managed = projections.find((projection) => (
    projection.sessionId === opaqueId(INSTALLATION_ID, "source", "codex:subagent-source")
  ));
  const primary = projections.find((projection) => (
    projection.sessionId === opaqueId(INSTALLATION_ID, "source", "codex:primary-source")
  ));

  assert.equal(managed?.isSubagent, true);
  assert.equal(managed?.disclosureScope, "metadata_only");
  assert.equal(primary?.isSubagent, undefined);
  assert.equal(JSON.stringify(projections).includes("private-parent-id"), false);
  assert.equal(JSON.stringify(projections).includes("private nickname"), false);
  assert.equal(JSON.stringify(projections).includes("private role"), false);
});

test("cloud session projection maps managed, source, and local runtime and state metadata", async () => {
  const projections = await readCloudSessionProjection(INSTALLATION_ID, projectionSource({
    managed: [
      managedSession({
        id: "managed-claude",
        adapterId: "claude-code",
        status: "failed",
        replyState: { phase: "waiting", promptText: null, requestedAt: VALID_TIMESTAMP }
      }),
      managedSession({ id: "managed-generic", adapterId: "generic-cli", status: "running" }),
      managedSession({
        id: "managed-approval",
        status: "running",
        actionRequest: {
          kind: "approval",
          command: "private-command",
          reason: "private-reason",
          requestedAt: VALID_TIMESTAMP
        }
      })
    ],
    source: [
      sourceSession({
        id: "source-claude",
        sourceSessionId: "source-claude",
        agentId: "claude-code",
        workState: "running"
      }),
      sourceSession({
        id: "source-other",
        sourceSessionId: "source-other",
        agentId: "other",
        workState: "idle"
      })
    ],
    local: [
      localChat({ id: "local-idle", runtimeId: "ollama", generationState: "idle" }),
      localChat({ id: "local-running", runtimeId: "lm-studio", generationState: "running" }),
      localChat({ id: "local-approval", generationState: "waiting_approval" }),
      localChat({ id: "local-failed", generationState: "failed" }),
      localChat({ id: "local-interrupted", generationState: "interrupted" })
    ]
  }));
  const stateById = new Map(projections.map((projection) => [projection.sessionId, projection]));

  const readState = (kind: string, localId: string) => {
    const projection = stateById.get(opaqueId(INSTALLATION_ID, kind, localId));

    assert.ok(projection);

    return {
      runtime: projection.runtime,
      status: projection.status,
      replyState: projection.replyState
    };
  };

  assert.deepEqual(readState("managed", "managed-claude"), {
    runtime: "claude_code", status: "failed", replyState: "waiting_for_agent"
  });
  assert.deepEqual(readState("managed", "managed-generic"), {
    runtime: "generic_cli", status: "running", replyState: "idle"
  });
  assert.deepEqual(readState("managed", "managed-approval"), {
    runtime: "codex", status: "running", replyState: "waiting_for_user"
  });
  assert.deepEqual(readState("source", "claude-code:source-claude"), {
    runtime: "claude_code", status: "running", replyState: "waiting_for_agent"
  });
  assert.deepEqual(readState("source", "other:source-other"), {
    runtime: "generic_cli", status: "read_only", replyState: "idle"
  });
  assert.deepEqual(readState("local", "local-idle"), {
    runtime: "ollama", status: "read_only", replyState: "idle"
  });
  assert.deepEqual(readState("local", "local-running"), {
    runtime: "lm_studio", status: "running", replyState: "waiting_for_agent"
  });
  assert.deepEqual(readState("local", "local-approval"), {
    runtime: "ollama", status: "running", replyState: "waiting_for_user"
  });
  assert.deepEqual(readState("local", "local-failed"), {
    runtime: "ollama", status: "failed", replyState: "idle"
  });
  assert.deepEqual(readState("local", "local-interrupted"), {
    runtime: "ollama", status: "stopped", replyState: "idle"
  });
});

test("cloud session projection reserves user attention for explicit action requests", async () => {
  const projections = await readCloudSessionProjection(INSTALLATION_ID, projectionSource({
    managed: [
      managedSession({
        id: "managed-running-idle",
        status: "running",
        replyState: { phase: "idle", promptText: null, requestedAt: null }
      }),
      managedSession({
        id: "managed-prompt-in-flight",
        status: "running",
        replyState: {
          phase: "waiting",
          promptText: "private prompt",
          requestedAt: VALID_TIMESTAMP
        }
      }),
      managedSession({
        id: "managed-explicit-approval",
        status: "running",
        actionRequest: {
          kind: "approval",
          command: "private command",
          reason: "private reason",
          requestedAt: VALID_TIMESTAMP
        }
      })
    ],
    source: [
      sourceSession({
        id: "source-idle-history",
        sourceSessionId: "source-idle-history",
        attachMode: "read_only",
        workState: "idle"
      }),
      sourceSession({
        id: "source-running",
        sourceSessionId: "source-running",
        attachMode: "read_only",
        workState: "running"
      })
    ],
    local: [
      localChat({ id: "local-idle", generationState: "idle" }),
      localChat({ id: "local-approval", generationState: "waiting_approval" })
    ]
  }));
  const stateById = new Map(projections.map((projection) => [projection.sessionId, projection]));
  const replyState = (kind: string, localId: string) =>
    stateById.get(opaqueId(INSTALLATION_ID, kind, localId))?.replyState;

  assert.equal(replyState("managed", "managed-running-idle"), "idle");
  assert.equal(replyState("managed", "managed-prompt-in-flight"), "waiting_for_agent");
  assert.equal(replyState("managed", "managed-explicit-approval"), "waiting_for_user");
  assert.equal(replyState("source", "codex:source-idle-history"), "idle");
  assert.equal(replyState("source", "codex:source-running"), "waiting_for_agent");
  assert.equal(replyState("local", "local-idle"), "idle");
  assert.equal(replyState("local", "local-approval"), "waiting_for_user");
});

test("cloud session projection caps the emitted metadata at 512 records", async () => {
  const managed = Array.from({ length: 520 }, (_, index) => managedSession({
    id: `managed-${index}`
  }));

  const projections = await readCloudSessionProjection(
    INSTALLATION_ID,
    projectionSource({ managed })
  );

  assert.equal(projections.length, 512);
  assert.equal(projections[0]?.sessionId, opaqueId(INSTALLATION_ID, "managed", "managed-0"));
  assert.equal(projections[511]?.sessionId, opaqueId(INSTALLATION_ID, "managed", "managed-511"));
  assert.equal(
    projections.some((projection) =>
      projection.sessionId === opaqueId(INSTALLATION_ID, "managed", "managed-512")
    ),
    false
  );
});

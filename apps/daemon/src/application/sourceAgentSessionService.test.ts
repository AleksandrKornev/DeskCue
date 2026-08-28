import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSessionDetail, ServerEvent } from "@deskcue/protocol";
import {
  markSourceAgentDetailMetadata,
  readSourceAgentDetailMetadata
} from "#agents/sourceAgentDetailMetadata";

import { AppError } from "./errors.ts";
import type { SourceAgentSessionBackend, SourceAgentSessionDiscovery } from "./ports.ts";
import { SourceAgentSessionService } from "./sourceAgentSessionService.ts";
import type { WorkspaceService } from "./workspaceService.ts";

test("source agent session service separates live metadata from forced discovery", async () => {
  const calls: Array<Parameters<SourceAgentSessionDiscovery["listRecentSessions"]>> = [];
  const listRecentSessions: SourceAgentSessionDiscovery["listRecentSessions"] = async (
    limit,
    workspaces,
    options
  ) => {
    calls.push([limit, workspaces, options]);
    return [];
  };

  const service = new SourceAgentSessionService(
    {} as ConstructorParameters<typeof SourceAgentSessionService>[0],
    {
      listRecentSessions
    } as unknown as SourceAgentSessionDiscovery,
    {
      listWorkspaces: () => []
    } as unknown as WorkspaceService
  );

  await service.listRecentSessions(50, true);
  await service.listRecentSessions(50, true, {
    force: true
  });

  assert.deepEqual(calls.map((call) => call[2]), [
    {
      force: undefined,
      includeLiveMetadata: true
    },
    {
      force: true,
      includeLiveMetadata: true
    }
  ]);
});

function agentSessionDetail(): AgentSessionDetail {
  return {
    id: "codex:source-1",
    agentId: "codex",
    agentLabel: "Codex",
    sourceSessionId: "source-1",
    title: "Reviewed chat",
    workspacePath: "C:\\projects\\ExampleWorkspace",
    workspaceName: "ExampleWorkspace",
    updatedAt: "2026-07-17T07:00:00.000Z",
    model: "GPT-5.5",
    originator: null,
    cliVersion: null,
    source: "codex",
    filePath: "codex.jsonl",
    attachMode: "resume",
    attachModeReason: null,
    reviewedAt: null,
    workState: "idle",
    transcript: []
  };
}

test("source agent session service publishes reviewed and updated events for other clients", async () => {
  const events: ServerEvent[] = [];
  const service = new SourceAgentSessionService(
    {} as ConstructorParameters<typeof SourceAgentSessionService>[0],
    {
      getSessionDetail: async () => agentSessionDetail()
    } as unknown as SourceAgentSessionDiscovery,
    {
      listWorkspaces: () => []
    } as unknown as WorkspaceService,
    {
      decorateSession: (session) => ({
        ...session,
        reviewedAt: "2026-07-17T07:30:00.000Z"
      }),
      decorateSessions: (sessions) => sessions,
      markReviewed: () => "2026-07-17T07:30:00.000Z"
    },
    {
      on: () => undefined,
      publishServerEvent: (event) => {
        events.push(event);
      }
    }
  );

  const result = await service.markSessionReviewed("codex:source-1");

  assert.deepEqual(result, {
    agentSessionId: "codex:source-1",
    reviewedAt: "2026-07-17T07:30:00.000Z"
  });

  assert.equal(events[0]?.type, "agent.session.reviewed");
  assert.equal(events[1]?.type, "agent.session.updated");
  assert.equal(events[1]?.payload.id, "codex:source-1");
  assert.equal(events[1]?.payload.reviewedAt, "2026-07-17T07:30:00.000Z");
});

function createDeferred<TValue>() {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    reject,
    resolve
  };
}

test("source agent session service dedupes concurrent detail reads", async () => {
  let detailReads = 0;
  const detailGate = createDeferred<void>();
  const service = new SourceAgentSessionService(
    {} as ConstructorParameters<typeof SourceAgentSessionService>[0],
    {
      getSessionDetail: async () => {
        detailReads += 1;
        await detailGate.promise;
        return agentSessionDetail();
      }
    } as unknown as SourceAgentSessionDiscovery,
    {
      listWorkspaces: () => []
    } as unknown as WorkspaceService
  );

  const firstRead = service.getSessionDetail("codex:source-1", false, undefined, 24);
  const secondRead = service.getSessionDetail("codex:source-1", false, undefined, 24);

  assert.equal(detailReads, 1);
  detailGate.resolve();

  assert.deepEqual(
    (await Promise.all([firstRead, secondRead])).map((session) => session?.id),
    ["codex:source-1", "codex:source-1"]
  );
});

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;

  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for source-agent reads.");

    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("source agent session service keeps dedupe ownership while bounding active reads", async () => {
  const gates = Array.from({ length: 129 }, () => createDeferred<void>());
  let activeReads = 0;
  let maxActiveReads = 0;
  let startedReads = 0;
  const service = new SourceAgentSessionService(
    {} as ConstructorParameters<typeof SourceAgentSessionService>[0],
    {
      getSessionDetail: async (sessionId: string) => {
        const index = Number(sessionId.slice(sessionId.lastIndexOf("-") + 1));

        startedReads += 1;

        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await gates[index]!.promise;
        activeReads -= 1;
        return agentSessionDetail();
      }
    } as unknown as SourceAgentSessionDiscovery,
    {
      listWorkspaces: () => []
    } as unknown as WorkspaceService,
    undefined,
    undefined,
    { concurrency: 128, queueCapacity: 8 }
  );

  const reads = gates.map((_, index) => service.getSessionDetail(`codex:source-${index}`));
  const duplicateQueuedRead = service.getSessionDetail("codex:source-128");

  await waitFor(() => startedReads === 128);

  assert.equal(maxActiveReads, 128);
  assert.equal(startedReads, 128);
  gates[0]!.resolve();
  await waitFor(() => startedReads === 129);
  gates.slice(1).forEach((gate) => gate.resolve());

  const [results, duplicate] = await Promise.all([Promise.all(reads), duplicateQueuedRead]);

  assert.equal(results.length, 129);

  assert.equal(duplicate?.id, "codex:source-1");
  assert.equal(maxActiveReads, 128);
  assert.equal(startedReads, 129);
});

test("source agent session service rejects unique reads beyond its hard queue capacity", async () => {
  const gate = createDeferred<void>();
  let startedReads = 0;
  const service = new SourceAgentSessionService(
    {} as ConstructorParameters<typeof SourceAgentSessionService>[0],
    {
      getSessionDetail: async () => {
        startedReads += 1;
        await gate.promise;
        return agentSessionDetail();
      }
    } as unknown as SourceAgentSessionDiscovery,
    { listWorkspaces: () => [] } as unknown as WorkspaceService,
    undefined,
    undefined,
    { concurrency: 1, queueCapacity: 1 }
  );

  const active = service.getSessionDetail("codex:active");
  const queued = service.getSessionDetail("codex:queued");
  const duplicate = service.getSessionDetail("codex:queued");

  await assert.rejects(
    service.getSessionDetail("codex:overflow"),
    (error: unknown) => error instanceof AppError && /queue is full/i.test(error.message)
  );

  assert.equal(startedReads, 1);

  gate.resolve();
  await Promise.all([active, queued, duplicate]);
  assert.equal(startedReads, 2);
  await service.close();
});

test("source agent session service close rejects queued reads and drains active work", async () => {
  const gate = createDeferred<void>();
  let closeFinished = false;
  const service = new SourceAgentSessionService(
    {} as ConstructorParameters<typeof SourceAgentSessionService>[0],
    {
      getSessionDetail: async () => {
        await gate.promise;
        return agentSessionDetail();
      }
    } as unknown as SourceAgentSessionDiscovery,
    { listWorkspaces: () => [] } as unknown as WorkspaceService,
    undefined,
    undefined,
    { concurrency: 1, queueCapacity: 2 }
  );

  const active = service.getSessionDetail("codex:active");
  const queued = service.getSessionDetail("codex:queued");
  const close = service.close().then(() => { closeFinished = true; });

  await assert.rejects(
    queued,
    (error: unknown) => error instanceof AppError && /shutting down/i.test(error.message)
  );

  await assert.rejects(
    service.getSessionDetail("codex:late"),
    (error: unknown) => error instanceof AppError && /shutting down/i.test(error.message)
  );

  assert.equal(closeFinished, false);

  gate.resolve();
  await Promise.all([active, close, service.close()]);
  assert.equal(closeFinished, true);
});

test("source agent session service preserves hidden detail metadata after review decoration", async () => {
  const detail = agentSessionDetail();

  markSourceAgentDetailMetadata(detail, { readMode: "append-cache" });
  const service = new SourceAgentSessionService(
    {} as ConstructorParameters<typeof SourceAgentSessionService>[0],
    {
      getSessionDetail: async () => detail
    } as unknown as SourceAgentSessionDiscovery,
    {
      listWorkspaces: () => []
    } as unknown as WorkspaceService,
    {
      decorateSession: (session) => ({
        ...session,
        reviewedAt: "2026-07-17T07:30:00.000Z"
      }),
      decorateSessions: (sessions) => sessions,
      markReviewed: () => "2026-07-17T07:30:00.000Z"
    }
  );

  const session = await service.getSessionDetail("codex:source-1");

  assert.equal(readSourceAgentDetailMetadata(session)?.readMode, "append-cache");
  assert.equal(JSON.stringify(session).includes("sourceAgentDetailMetadata"), false);
});

test("managed source detail keeps review metadata and current attached state", async () => {
  const service = new SourceAgentSessionService(
    {
      reconcileAttachedAgentSession: (session: AgentSessionDetail) => ({
        ...session,
        attachMode: "resume" as const,
        attachModeReason: null
      })
    } as SourceAgentSessionBackend,
    {
      getSessionDetailForManagedSession: async () => ({
        ...agentSessionDetail(),
        attachMode: "read_only",
        attachModeReason: "Stale discovery state"
      })
    } as unknown as SourceAgentSessionDiscovery,
    {
      listWorkspaces: () => []
    } as unknown as WorkspaceService,
    {
      decorateSession: (session) => ({
        ...session,
        reviewedAt: "2026-07-17T07:30:00.000Z"
      }),
      decorateSessions: (sessions) => sessions,
      markReviewed: () => "2026-07-17T07:30:00.000Z"
    }
  );

  const detail = await service.getSessionDetailForManagedSession({
    id: "managed-1",
    adapterId: "codex",
    sourceSessionId: "source-1"
  } as Parameters<SourceAgentSessionDiscovery["getSessionDetailForManagedSession"]>[0]);

  assert.equal(detail?.reviewedAt, "2026-07-17T07:30:00.000Z");
  assert.equal(detail?.attachMode, "resume");
  assert.equal(detail?.attachModeReason, null);
});

test("source agent session service decorates source versions with review and local state", async () => {
  const backend: Pick<
    SourceAgentSessionBackend,
    "getAttachedAgentSessionStateVersion" | "reconcileAttachedAgentSession"
  > = {
    getAttachedAgentSessionStateVersion: () => "attached-state-1",
    reconcileAttachedAgentSession: (session) => ({
      ...session,
      attachMode: "resume",
      attachModeReason: null
    })
  };

  const service = new SourceAgentSessionService(
    backend as SourceAgentSessionBackend,
    {
      getSessionVersion: async () => ({
        sourceFileMtimeMs: 123,
        sourceFileSizeBytes: 456,
        sourceVersion: "source-version-1",
        summary: {
          ...agentSessionDetail(),
          attachMode: "read_only",
          attachModeReason: "Active elsewhere"
        }
      })
    } as unknown as SourceAgentSessionDiscovery,
    {
      listWorkspaces: () => []
    } as unknown as WorkspaceService,
    {
      decorateSession: (session) => ({
        ...session,
        reviewedAt: "2026-07-17T07:30:00.000Z"
      }),
      decorateSessions: (sessions) => sessions,
      markReviewed: () => "2026-07-17T07:30:00.000Z"
    }
  );

  const version = await service.getSessionVersion("codex:source-1");

  assert.equal(version?.localStateVersion, "attached-state-1");
  assert.equal(version?.summary.reviewedAt, "2026-07-17T07:30:00.000Z");
  assert.equal(version?.summary.attachMode, "resume");
  assert.equal(version?.sourceVersion, "source-version-1");
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalLlmChatService } from "#localLlmChats/chat/localLlmChatService";
import { LocalLlmChatLibrary } from "#localLlmChats/storage/localLlmChatLibrary";
import { LmStudioRuntimeCoordinator } from "#runtimeDiagnostics/lmStudioRuntimeCoordinator";

import { ManagedSessionService } from "../managedSessionService.ts";
import { ManualCommandService } from "../manualCommands/manualCommandService.ts";
import { SourceAgentSessionService } from "../sourceAgentSessionService.ts";
import { UpdateAdmission } from "./updateAdmission.ts";

test("process-starting service boundaries reject calls while an update lease is held", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "deskcue-update-admission-services-"));
  const admission = new UpdateAdmission();
  let called = false;
  const managed = new ManagedSessionService({
    stopSession: async () => {
      called = true;
      return {} as never;
    }
  } as never, {} as never, admission);
  const manual = new ManualCommandService({
    listWorkspaces: () => [{ id: "workspace", path: root }]
  } as never, {
    close: async () => undefined,
    run: async () => {
      called = true;
      return {} as never;
    }
  }, admission);
  const source = new SourceAgentSessionService(
    {
      resumeAgentSession: async () => {
        called = true;
        return {} as never;
      }
    } as never,
    {} as never,
    {} as never,
    undefined,
    undefined,
    {},
    admission
  );
  const lmStudio = new LmStudioRuntimeCoordinator({
    listModels: async () => {
      called = true;
      return [];
    },
    updateAdmission: admission
  });
  const localLlm = new LocalLlmChatService(
    new LocalLlmChatLibrary(root),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {},
    admission
  );
  const lease = admission.beginDrain();

  try {
    const results = await Promise.allSettled([
      managed.stopSession("managed"),
      manual.run("workspace", "echo blocked"),
      source.resumeAgentSession({} as never),
      lmStudio.listModels(),
      localLlm.createChat({} as never)
    ]);

    assert.equal(results.every((result) => result.status === "rejected"), true);
    assert.equal(called, false);
  } finally {
    lease.release();
    await Promise.allSettled([localLlm.close(), lmStudio.close(), source.close()]);
    await rm(root, { force: true, recursive: true });
  }
});

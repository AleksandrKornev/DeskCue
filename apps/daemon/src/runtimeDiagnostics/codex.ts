import os from "node:os";
import path from "node:path";

import type { RuntimeSummary } from "@deskcue/protocol";

import { commandExists, exists } from "./shared.ts";

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");

type CodexRuntimeProbes = {
  commandExists: typeof commandExists;
  exists: typeof exists;
};

const defaultProbes: CodexRuntimeProbes = {
  commandExists,
  exists
};

export async function inspectCodexRuntime(
  probes: CodexRuntimeProbes = defaultProbes
): Promise<RuntimeSummary> {
  const installed = await probes.commandExists("codex") || await probes.exists(CODEX_HOME);

  return {
    id: "codex",
    label: "Codex",
    installed,
    running: false,
    endpoint: null,
    modelCount: 0,
    loadedModelCount: 0,
    lastActiveModel: null,
    statusText: !installed
      ? "not installed"
      : "installed, local chat history can be restored"
  };
}

import os from "node:os";
import path from "node:path";

import type { RuntimeSummary } from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";

import {
  commandExists,
  execJsonCommand,
  exists,
  firstDefinedString
} from "./shared.ts";

type ClaudeCodeRuntimeProbes = {
  commandExists: typeof commandExists;
  execJsonCommand: typeof execJsonCommand;
  exists: typeof exists;
  firstDefinedString: typeof firstDefinedString;
};

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

const defaultProbes: ClaudeCodeRuntimeProbes = {
  commandExists,
  execJsonCommand,
  exists,
  firstDefinedString
};

async function readClaudeAgents(probes: ClaudeCodeRuntimeProbes) {
  try {
    const parsed = await probes.execJsonCommand(
      "claude",
      ["agents", "--json"],
      daemonConfig.runtimeCommandTimeoutMs
    );
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [];
  } catch {
    return [];
  }
}

export async function inspectClaudeCodeRuntime(
  probes: ClaudeCodeRuntimeProbes = defaultProbes
): Promise<RuntimeSummary> {
  const installed = await probes.commandExists("claude") || await probes.exists(CLAUDE_HOME);
  const liveAgents = installed ? await readClaudeAgents(probes) : [];

  return {
    id: "claude-code",
    label: "Claude Code",
    installed,
    running: liveAgents.length > 0,
    endpoint: null,
    modelCount: 0,
    loadedModelCount: liveAgents.length,
    lastActiveModel: probes.firstDefinedString(liveAgents, ["model", "agent_type"]) ?? null,
    statusText: !installed
      ? "not installed"
      : liveAgents.length > 0
        ? `${liveAgents.length} live sessions`
        : "installed, no live sessions detected"
  };
}

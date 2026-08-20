import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { claudeCodeAdapter } from "@deskcue/adapters";
import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { AppError } from "#application/errors";
import { logger } from "#infrastructure/logging/logger";
import type { RunningChild, SessionSpawnSpec } from "#sessions/process/sessionProcess";

import { runSourcePromptProcessLifecycle } from "../../sourceAgentPromptProcess.ts";
import type { SourcePromptProcessCallbacks } from "../../sourceAgentPromptProcess.ts";
import {
  findClaudeBackgroundAgent,
  resolveClaudeBackgroundControlCapability
} from "../processControl/claudeBackgroundControl.ts";

type RestartClaudePromptTransportCallbacks = SourcePromptProcessCallbacks & {
  getChild: (sessionId: string) => RunningChild | undefined;
  findBackgroundAgent?: typeof findClaudeBackgroundAgent;
  resolveBackgroundControlCapability?: typeof resolveClaudeBackgroundControlCapability;
  getWorkspace: (workspaceId: string) => WorkspaceSummary | null;
};

function canRestartClaudePrompt(session: SessionDetail) {
  return session.status === "read_only" || session.status === "stopped" || session.status === "done";
}

function resolveClaudePrintExecutable() {
  if (process.platform !== "win32") return "claude";

  for (const directory of (process.env.PATH ?? "").split(";")) {
    if (!directory) continue;

    const executable = join(
      directory,
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe"
    );
    if (existsSync(executable)) return executable;
  }

  return "claude";
}

export function buildClaudeResumePrintTransport(
  sourceSessionId: string,
  prompt: string
): { command: string; spawnSpec: SessionSpawnSpec } {
  const normalizedPrompt = prompt.trim();
  return {
    command: claudeCodeAdapter.buildResumePrintCommand(sourceSessionId, normalizedPrompt),
    spawnSpec: {
      closeStdin: true,
      file: resolveClaudePrintExecutable(),
      args: ["--resume", sourceSessionId, "--print", normalizedPrompt],
      surviveParentExit: true,
      transport: "pipe"
    }
  };
}

function resolveClaudeHomeDirectory(sourceSessionFilePath?: string | null) {
  if (sourceSessionFilePath) {
    const claudeConfigDirectory = dirname(dirname(dirname(sourceSessionFilePath)));
    if (existsSync(claudeConfigDirectory)) return dirname(claudeConfigDirectory);
  }

  return process.env.USERPROFILE ?? process.env.HOME ?? homedir();
}

export async function restartClaudePromptTransport(
  callbacks: RestartClaudePromptTransportCallbacks,
  session: SessionDetail,
  input: string
) {
  const prompt = input.trim();
  if (!prompt) throw new AppError("invalid_input", "Prompt is empty.");

  if (!session.sourceSessionId || session.adapterId !== claudeCodeAdapter.id) {
    throw new AppError("not_accepting_input", "Claude Code session is not accepting input.");
  }

  if (callbacks.getChild(session.id)) {
    throw new AppError(
      "not_accepting_input",
      "Claude Code is still processing the previous prompt. Interrupt it or wait for the reply."
    );
  }

  if (!canRestartClaudePrompt(session)) {
    throw new AppError("not_accepting_input", "Claude Code session is not accepting input.");
  }

  const backgroundAgent = await (callbacks.findBackgroundAgent ?? findClaudeBackgroundAgent)(
    session.sourceSessionId
  );
  if (backgroundAgent) {
    throw new AppError(
      "not_accepting_input",
      "This Claude Code background chat can be observed or stopped, but Claude CLI cannot continue it in the same chat."
    );
  }

  const backgroundControlCapability = await (
    callbacks.resolveBackgroundControlCapability ?? resolveClaudeBackgroundControlCapability
  )(session.sourceSessionId);
  if (
    backgroundControlCapability.kind !== "observe_only" ||
    backgroundControlCapability.reason !== "session_not_listed"
  ) {
    const message =
      backgroundControlCapability.kind === "observe_only" &&
      backgroundControlCapability.reason === "interactive_session"
        ? "This Claude Code chat is active outside DeskCue. DeskCue can observe it but will not start a competing prompt."
        : "DeskCue cannot safely verify that this Claude Code chat is idle.";
    throw new AppError("not_accepting_input", message);
  }

  const workspace = callbacks.getWorkspace(session.workspaceId);
  if (!workspace) throw new AppError("not_found", "Workspace not found.");

  const requestedAt = new Date().toISOString();
  const { command, spawnSpec } = buildClaudeResumePrintTransport(session.sourceSessionId, prompt);
  const claudeHome = resolveClaudeHomeDirectory(session.sourceSessionFilePath);
  const configuredClaudeConfigDirectory = process.env.CLAUDE_CONFIG_DIR?.trim();
  const updatedSession = await runSourcePromptProcessLifecycle(callbacks, {
    command,
    env: {
      CLAUDE_CONFIG_DIR: configuredClaudeConfigDirectory || join(claudeHome, ".claude"),
      HOME: process.env.HOME ?? claudeHome,
      USERPROFILE: process.env.USERPROFILE ?? claudeHome
    },
    logStarted: (child) => {
      logger.info("Claude prompt transport started", {
        sessionId: session.id,
        sourceSessionId: session.sourceSessionId,
        pid: child.pid ?? null,
        inputLength: prompt.length
      });
    },
    prompt,
    requestedAt,
    session,
    spawnSpec,
    startedMessage: "DeskCue started a one-shot Claude Code resume for this prompt.\n",
    workspace
  });
  return updatedSession ?? session;
}

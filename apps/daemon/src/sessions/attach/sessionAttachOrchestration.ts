import { performance } from "node:perf_hooks";

import { claudeCodeAdapter, codexAdapter } from "@deskcue/adapters";
import type {
  AgentSessionDetail,
  AgentSessionSummary,
  CodexSessionDetail,
  CodexSessionSummary,
  SessionDetail,
  WorkspaceSummary
} from "@deskcue/protocol";
import {
  assertAgentSessionResumable,
  buildFallbackCodexSessionSummary
} from "#agents/agentSessionAttach";
import {
  findClaudeBackgroundAgent,
  resolveClaudeBackgroundControlCapability
} from "#agents/claude/processControl/claudeBackgroundControl";
import { getCodexSessionDetail } from "#agents/codex/codexFacade";
import {
  getCodexAttachState,
  isManagedSessionOwnActiveTurn
} from "#agents/codex/session/codexReplyState";
import { buildCodexResumeTransport } from "#agents/codex/session/codexTransport";
import { AppError } from "#application/errors";
import { logger } from "#infrastructure/logging/logger";
import type { SessionSpawnSpec } from "#sessions/process/sessionProcess";

type LaunchSessionInput = {
  adapterId: string;
  argvInput?: string;
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
  initialInput?: string;
  sourceSessionId: string | null;
  spawnSpec?: SessionSpawnSpec;
  workspace: WorkspaceSummary;
};

type RestartCodexTransportOptions = {
  prompt?: string;
  reason: "prompt" | "interrupt";
};

type SessionAttachOrchestrationCallbacks = {
  createReadOnlyClaudeSession?: (
    agentSession: AgentSessionSummary,
    options: { observeOnly?: boolean; reason: string }
  ) => Promise<SessionDetail>;
  createReadOnlyCodexSession: (
    codexSession: CodexSessionSummary | CodexSessionDetail,
    reason: string
  ) => Promise<SessionDetail>;
  createWorkspace: (workspacePath: string) => Promise<WorkspaceSummary>;
  findReadOnlyAttachedSession: (sourceSessionId: string) => SessionDetail | null;
  findReusableAttachedSession: (sourceSessionId: string) => SessionDetail | null;
  getSession: (sessionId: string) => SessionDetail | null;
  launchSession: (input: LaunchSessionInput) => Promise<SessionDetail>;
  restartClaudePromptTransport?: (session: SessionDetail, input: string) => Promise<SessionDetail>;
  restartCodexTransport: (
    session: SessionDetail,
    options: RestartCodexTransportOptions
  ) => Promise<SessionDetail>;
  sendInput: (sessionId: string, input: string) => Promise<SessionDetail>;
};

type SourceAgentAttachStrategy = {
  adapterId: string;
  resume: (
    callbacks: SessionAttachOrchestrationCallbacks,
    agentSession: AgentSessionSummary | AgentSessionDetail,
    prompt?: string
  ) => Promise<SessionDetail>;
};

const CODEX_ATTACH_TRANSCRIPT_TAIL = 160;

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function toCodexRuntimeContext(codexSession: CodexSessionSummary | CodexSessionDetail) {
  return {
    approvalPolicy: codexSession.approvalPolicy,
    model: codexSession.model,
    sandboxMode: codexSession.sandboxMode
  };
}

export async function resumeCodexAgentSession(
  callbacks: SessionAttachOrchestrationCallbacks,
  codexSession: CodexSessionSummary | CodexSessionDetail,
  prompt?: string
) {
  const startedAt = performance.now();
  const runningExisting = callbacks.findReusableAttachedSession(codexSession.id);
  const readOnlyExisting = runningExisting
    ? null
    : callbacks.findReadOnlyAttachedSession(codexSession.id);
  const codexSessionDetail = "transcript" in codexSession ? codexSession : null;
  const attachState = codexSessionDetail
    ? getCodexAttachState(codexSessionDetail.transcript)
    : null;
  const normalizedPrompt = prompt?.trim();
  const existingForOwnershipCheck = runningExisting ?? readOnlyExisting;
  const isActiveElsewhere =
    attachState?.mode !== "resume" &&
    (
      !existingForOwnershipCheck ||
      !codexSessionDetail ||
      !isManagedSessionOwnActiveTurn(existingForOwnershipCheck, codexSessionDetail)
    );
  const existing = runningExisting ?? (isActiveElsewhere ? readOnlyExisting : null);

  if (existing) {
    logger.info("Reusing existing attached Codex session", {
      sessionId: existing.id,
      sourceSessionId: codexSession.id,
      status: existing.status
    });

    if (runningExisting && isActiveElsewhere && normalizedPrompt) {
      logger.info("Restarting existing Codex transport from attach", {
        sessionId: existing.id,
        sourceSessionId: codexSession.id,
        totalDurationMs: elapsedMs(startedAt)
      });
      return callbacks.restartCodexTransport(existing, {
        prompt: normalizedPrompt,
        reason: "prompt"
      });
    }

    if (normalizedPrompt) {
      logger.info("Forwarding attach prompt to existing Codex session", {
        sessionId: existing.id,
        sourceSessionId: codexSession.id,
        totalDurationMs: elapsedMs(startedAt)
      });
      return callbacks.sendInput(existing.id, normalizedPrompt);
    }

    if (runningExisting && isActiveElsewhere) {
      logger.info("Creating read-only Codex shell from existing attached session", {
        sessionId: existing.id,
        sourceSessionId: codexSession.id,
        totalDurationMs: elapsedMs(startedAt)
      });
      return callbacks.createReadOnlyCodexSession(
        codexSession,
        attachState?.reason ||
          "This Codex thread is active in another client right now."
      );
    }

    logger.info("Returning existing Codex session from attach", {
      sessionId: existing.id,
      sourceSessionId: codexSession.id,
      totalDurationMs: elapsedMs(startedAt)
    });
    return callbacks.getSession(existing.id)!;
  }

  if (isActiveElsewhere && !normalizedPrompt) {
    logger.info("Creating read-only Codex shell for active external thread", {
      sourceSessionId: codexSession.id,
      totalDurationMs: elapsedMs(startedAt)
    });
    return callbacks.createReadOnlyCodexSession(
      codexSession,
      attachState?.reason ||
        "This Codex thread is active in another client right now."
    );
  }

  const workspaceStartedAt = performance.now();
  const workspace = await callbacks.createWorkspace(codexSession.workspacePath);
  const workspaceDurationMs = elapsedMs(workspaceStartedAt);
  const transportStartedAt = performance.now();
  const { command, spawnSpec } = await buildCodexResumeTransport({
    sourceSessionId: codexSession.id,
    prompt: normalizedPrompt,
    runtimeContext: toCodexRuntimeContext(codexSession)
  });
  const transportDurationMs = elapsedMs(transportStartedAt);

  const launchStartedAt = performance.now();
  const session = await callbacks.launchSession({
    workspace,
    command,
    cwd: workspace.path,
    env: {},
    adapterId: codexAdapter.id,
    sourceSessionId: codexSession.id,
    argvInput: normalizedPrompt,
    spawnSpec
  });
  logger.info("Codex attach launched managed session", {
    sessionId: session.id,
    sourceSessionId: codexSession.id,
    workspaceDurationMs,
    transportDurationMs,
    launchDurationMs: elapsedMs(launchStartedAt),
    totalDurationMs: elapsedMs(startedAt)
  });

  return session;
}

export async function resumeClaudeAgentSession(
  callbacks: SessionAttachOrchestrationCallbacks,
  agentSession: AgentSessionSummary,
  prompt?: string
) {
  if (!callbacks.createReadOnlyClaudeSession || !callbacks.restartClaudePromptTransport) {
    throw new AppError("not_accepting_input", "Claude Code prompt delivery is unavailable.");
  }

  const backgroundAgent = await findClaudeBackgroundAgent(agentSession.sourceSessionId);
  const activeControlCapability = backgroundAgent
    ? null
    : await resolveClaudeBackgroundControlCapability(agentSession.sourceSessionId);
  const isObserveOnly =
    Boolean(backgroundAgent) ||
    (activeControlCapability?.kind === "observe_only" &&
      activeControlCapability.reason !== "session_not_listed");
  const shell = await callbacks.createReadOnlyClaudeSession(agentSession, {
    observeOnly: isObserveOnly,
    reason: backgroundAgent
      ? "Claude started this as a background job, so DeskCue can observe it but cannot continue the same chat."
      : isObserveOnly
        ? "Claude Code reports this chat as active outside DeskCue, so DeskCue will keep it in observation mode."
      : "DeskCue will start a one-shot Claude resume only when you send a prompt."
  });

  if (!prompt?.trim()) return shell;

  if (isObserveOnly) {
    throw new AppError(
      "not_accepting_input",
      "This Claude Code background chat can be observed or stopped, but Claude CLI cannot continue it in the same chat."
    );
  }

  return callbacks.restartClaudePromptTransport(shell, prompt);
}

function toCodexSession(
  agentSession: AgentSessionSummary | AgentSessionDetail
): CodexSessionSummary | CodexSessionDetail {
  const summary = buildFallbackCodexSessionSummary(agentSession);
  if (!("transcript" in agentSession)) return summary;

  return {
    ...summary,
    transcript: agentSession.transcript
  };
}

async function resumeDiscoveredCodexSession(
  callbacks: SessionAttachOrchestrationCallbacks,
  agentSession: AgentSessionSummary | AgentSessionDetail,
  prompt?: string
) {
  if (agentSession.attachMode !== "resume" && !prompt?.trim()) {
    return resumeCodexAgentSession(
      callbacks,
      toCodexSession(agentSession),
      prompt
    );
  }

  const codexSession =
    "transcript" in agentSession
      ? toCodexSession(agentSession)
      : await getCodexSessionDetail(
          agentSession.sourceSessionId,
          true,
          CODEX_ATTACH_TRANSCRIPT_TAIL
        );
  return resumeCodexAgentSession(
    callbacks,
    codexSession ?? toCodexSession(agentSession),
    prompt
  );
}

async function resumeDiscoveredClaudeSession(
  callbacks: SessionAttachOrchestrationCallbacks,
  agentSession: AgentSessionSummary | AgentSessionDetail,
  prompt?: string
) {
  assertAgentSessionResumable(agentSession);
  return resumeClaudeAgentSession(callbacks, agentSession, prompt);
}

const SOURCE_AGENT_ATTACH_STRATEGIES: ReadonlyMap<
  string,
  SourceAgentAttachStrategy
> = new Map([
  [
    codexAdapter.id,
    {
      adapterId: codexAdapter.id,
      resume: resumeDiscoveredCodexSession
    }
  ],
  [
    claudeCodeAdapter.id,
    {
      adapterId: claudeCodeAdapter.id,
      resume: resumeDiscoveredClaudeSession
    }
  ]
]);

function getSourceAgentAttachStrategy(adapterId: string) {
  const strategy = SOURCE_AGENT_ATTACH_STRATEGIES.get(adapterId);
  if (strategy?.adapterId === adapterId) return strategy;

  throw new AppError(
    "not_accepting_input",
    `Adapter ${adapterId} does not support attach yet.`
  );
}

export async function resumeDiscoveredAgentSession(
  callbacks: SessionAttachOrchestrationCallbacks,
  agentSession: AgentSessionSummary | AgentSessionDetail,
  prompt?: string
) {
  const existing = callbacks.findReusableAttachedSession(agentSession.sourceSessionId);
  if (existing) {
    logger.info("Reusing existing attached agent session", {
      sessionId: existing.id,
      sourceSessionId: agentSession.sourceSessionId,
      status: existing.status
    });
    if (prompt?.trim()) return callbacks.sendInput(existing.id, prompt);
    return callbacks.getSession(existing.id)!;
  }

  const strategy = getSourceAgentAttachStrategy(agentSession.agentId);
  return strategy.resume(callbacks, agentSession, prompt);
}

import type { SubmitEvent } from "react";
import { toast } from "sonner";

import type { SessionDetail } from "@deskcue/protocol";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import { isSessionCommandAccepted } from "@api/endpoint/sessions/types";
import {
  hasApiErrorPayload,
  readApiErrorMessage
} from "@api/transport/httpClient";
import {
  acquirePendingCloudCommand,
  clearPendingCloudCommand,
  clearPendingCloudCommandForResult
} from "@api/transport/pendingCommandJournal";
import { toMessage } from "@lib/format";
import { mergeSessionUpdate } from "@modules/dashboard/model/prompt/sessionUpdate";
import { useDashboardPromptCommandHandler } from "@modules/dashboard/model/prompt/useDashboardPromptCommandHandler";

import {
  beginAgentAttachOperation,
  isAgentAttachOperationCurrent
} from "./agentAttachOperation";
import {
  isCloudControlReceipt,
  recoverStoppedManagedSession
} from "./managedStopRecovery";
import {
  formatManualCommandDuration,
  formatManualCommandExit
} from "./manualCommandResult";
import {
  captureSessionSelectionOperation,
  isSessionSelectionOperationCurrent
} from "./selectionOperation";
import type { SessionSelectionOperation } from "./selectionOperation";
import type {
  AgentAttachOperationState,
  AttachAgentSessionHandlerArgs,
  StartSessionHandlerArgs,
  StopSessionHandlerArgs,
  UseDashboardCommandHandlersArgs
} from "./types";
import { useDashboardPreviewCommandHandlers } from "./useDashboardPreviewCommandHandlers";

async function runStartSession(
  args: StartSessionHandlerArgs,
  event: SubmitEvent<HTMLFormElement>
) {
  const {
    command,
    loadAgentSessions,
    loadOverview,
    selectedWorkspaceId,
    setError,
    setLoading
  } = args;

  event.preventDefault();
  if (!selectedWorkspaceId) {
    setError("Add or select a workspace first");
    return;
  }

  setLoading(true);
  setError("");

  try {
    const result = await sessionsApi.runManualCommand(selectedWorkspaceId, command);

    if (!result.ok || hasApiErrorPayload(result.data)) {
      throw new Error(readApiErrorMessage(result.data, "Failed to run command"));
    }

    if (result.data.status === "started") {
      toast.success(
        `Command started${result.data.pid ? `, pid ${result.data.pid}` : ""}`
      );
    } else if (result.data.ok) {
      toast.success(`Command finished in ${formatManualCommandDuration(result.data.durationMs)}`);
    } else {
      toast.error(
        `Command failed${formatManualCommandExit(result.data)} in ${formatManualCommandDuration(result.data.durationMs)}`
      );
    }

    Promise.all([
      loadOverview({ silent: true }),
      loadAgentSessions({ silent: true })
    ]).catch((caughtError) => {
      setError(toMessage(caughtError));
    });
  } catch (caughtError) {
    setError(toMessage(caughtError));
    toast.error(toMessage(caughtError));
  } finally {
    setLoading(false);
  }
}

function isCurrentAgentAttach(
  args: AttachAgentSessionHandlerArgs,
  operation: AgentAttachOperationState
) {
  return isAgentAttachOperationCurrent(
    args.agentAttachOperationRef,
    args.selectedAgentSessionIdRef,
    operation
  );
}

async function runAttachAgentSession(args: AttachAgentSessionHandlerArgs) {
  const {
    agentAttachOperationRef,
    loadAgentSessions,
    loadSession,
    selectedAgentSessionId,
    setActiveTab,
    setAttachingAgentSessionId,
    setError,
    setSelectedSession,
    setSelectedSessionId,
    setSelectedWorkspaceId
  } = args;

  if (!selectedAgentSessionId) return null;

  const attachingAgentSessionId = selectedAgentSessionId;
  const attachOperation = beginAgentAttachOperation(
    agentAttachOperationRef,
    attachingAgentSessionId
  );

  setAttachingAgentSessionId(attachingAgentSessionId);
  setError("");

  try {
    const command = acquirePendingCloudCommand("source.attach", attachingAgentSessionId);
    const result = await agentSessionsApi.attach(
      attachingAgentSessionId,
      "",
      command.commandId
    );

    if (result.ok && !hasApiErrorPayload(result.data)) clearPendingCloudCommand(command);
    if (!isCurrentAgentAttach(args, attachOperation)) return null;

    if (!result.ok || hasApiErrorPayload(result.data)) {
      throw new Error(readApiErrorMessage(result.data, "Failed to attach agent session"));
    }

    const attachedSession = isSessionCommandAccepted(result.data)
      ? await loadSession(result.data.sessionId, { sessionView: "chat" })
      : result.data;

    if (!isCurrentAgentAttach(args, attachOperation)) return null;

    if (!attachedSession) {
      throw new Error("The attach request was accepted, but DeskCue could not load the session.");
    }

    setSelectedWorkspaceId(attachedSession.workspaceId);
    setSelectedSessionId(attachedSession.id);
    setSelectedSession(attachedSession);
    setActiveTab("overview");

    loadAgentSessions({ silent: true }).catch((caughtError) => {
      setError(toMessage(caughtError));
    });

    return attachedSession;
  } catch (caughtError) {
    if (isCurrentAgentAttach(args, attachOperation)) setError(toMessage(caughtError));

    return null;
  } finally {
    if (isCurrentAgentAttach(args, attachOperation)) {
      setAttachingAgentSessionId("");
    }
  }
}

function applyStoppedSession(
  args: StopSessionHandlerArgs,
  stoppedSession: SessionDetail
) {
  const {
    loadOverview,
    promptDelivery,
    selectedSession,
    setActiveTab,
    setError,
    setSelectedSession,
    updateOverview
  } = args;

  if (selectedSession?.id === stoppedSession.id) setSelectedSession(stoppedSession);

  promptDelivery.clearPromptDeliveryState();
  updateOverview((current) => ({
    ...current,
    sessions: current.sessions.map((session) =>
      session.id === stoppedSession.id ? { ...session, ...stoppedSession } : session
    )
  }));
  setActiveTab("overview");

  loadOverview({ silent: true }).catch((caughtError) => {
    setError(toMessage(caughtError));
  });

  return true;
}

function isCurrentSessionStop(
  args: StopSessionHandlerArgs,
  operation: SessionSelectionOperation
) {
  return isSessionSelectionOperationCurrent(
    args.selectedSessionIdRef,
    args.selectedSessionSelectionEpochRef,
    operation
  );
}

async function runStopSession(args: StopSessionHandlerArgs) {
  const {
    loadSession,
    selectedSession,
    selectedSessionId,
    selectedSessionSelectionEpochRef,
    setError
  } = args;

  if (!selectedSessionId) return false;

  const stoppingSessionId = selectedSessionId;
  const selectionOperation = captureSessionSelectionOperation(
    stoppingSessionId,
    selectedSessionSelectionEpochRef
  );
  const pendingCommand = acquirePendingCloudCommand(
    "managed.stop",
    stoppingSessionId
  );
  const result = await sessionsApi.stop(stoppingSessionId, pendingCommand.commandId);
  const definitive = clearPendingCloudCommandForResult(pendingCommand, result);

  if (!isCurrentSessionStop(args, selectionOperation)) return false;

  if (result.ok && isCloudControlReceipt(result.data, stoppingSessionId)) {
    const recoveredSession = await recoverStoppedManagedSession(
      stoppingSessionId,
      loadSession
    );

    if (!isCurrentSessionStop(args, selectionOperation)) return false;

    if (!recoveredSession) {
      setError("Session stop completed, but DeskCue could not load the stopped session.");
      return false;
    }

    return applyStoppedSession(args, recoveredSession);
  }

  if (!result.ok || hasApiErrorPayload(result.data)) {
    if (!definitive) {
      const recoveredSession = await recoverStoppedManagedSession(
        stoppingSessionId,
        loadSession
      );

      if (!isCurrentSessionStop(args, selectionOperation)) return false;

      if (recoveredSession) {
        clearPendingCloudCommand(pendingCommand);
        return applyStoppedSession(args, recoveredSession);
      }
    }

    setError(readApiErrorMessage(result.data, "Failed to stop session"));
    return false;
  }

  const stoppedSession = mergeSessionUpdate(selectedSession, result.data);

  return applyStoppedSession(args, stoppedSession);
}

export function useDashboardCommandHandlers(args: UseDashboardCommandHandlersArgs) {
  const {
    overview,
    selectedAgentSessionId,
    selectedSessionId,
    selectedSession,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    selectedSessionRef,
    promptOperationRef,
    previewPort,
    setPreviewPort,
    promptDelivery,
    setSelectedWorkspaceId,
    setSelectedSessionId,
    setSelectedSession,
    setActiveTab,
    setError,
    loadOverview,
    loadAgentSessions,
    loadSession
  } = args;

  const handleSendInput = useDashboardPromptCommandHandler({
    overview,
    selectedAgentSessionId,
    selectedSessionId,
    selectedSession,
    selectedSessionIdRef,
    selectedSessionRef,
    promptOperationRef,
    promptDelivery,
    setSelectedWorkspaceId,
    setSelectedSessionId,
    setSelectedSession,
    setActiveTab,
    setError,
    loadAgentSessions,
    loadSession
  });

  const {
    handleChangePreviewNetworkMode,
    handleChangePreviewPort,
    handleRefreshGit,
    previewError,
    handleSetPreview,
    handleStopPreview
  } = useDashboardPreviewCommandHandlers({
    selectedSessionId,
    selectedSession,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    previewPort,
    setPreviewPort,
    setSelectedSession,
    setError,
    loadOverview
  });

  return {
    handleStartSession: (event: SubmitEvent<HTMLFormElement>) => runStartSession(args, event),
    handleAttachAgentSession: () => runAttachAgentSession(args),
    handleSendInput,
    handleStopSession: () => runStopSession(args),
    handleChangePreviewNetworkMode,
    handleChangePreviewPort,
    handleRefreshGit,
    previewError,
    handleSetPreview,
    handleStopPreview
  };
}

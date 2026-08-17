import type { FormEvent } from "react";
import { toast } from "sonner";

import type { SessionDetail } from "@deskcue/protocol";
import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import { isSessionCommandAccepted } from "@api/endpoint/sessions/types";
import { workspacesApi } from "@api/endpoint/workspaces/endpoints";
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
import type { UseDashboardCommandHandlersArgs } from "./types";
import { useDashboardPreviewCommandHandlers } from "./useDashboardPreviewCommandHandlers";

export function useDashboardCommandHandlers({
  overview,
  workspacePath,
  selectedWorkspaceId,
  command,
  selectedAgentSessionId,
  selectedAgentSessionIdRef,
  agentAttachOperationRef,
  selectedSessionId,
  selectedSession,
  selectedSessionIdRef,
  selectedSessionSelectionEpochRef,
  selectedSessionRef,
  promptOperationRef,
  previewPort,
  promptDelivery,
  setWorkspacePath,
  updateOverview,
  setSelectedWorkspaceId,
  setSelectedSessionId,
  setSelectedSession,
  setActiveTab,
  setError,
  setLoading,
  setPickingWorkspace,
  setAttachingAgentSessionId,
  loadOverview,
  loadAgentSessions,
  loadSession
}: UseDashboardCommandHandlersArgs) {
  async function handleAddWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspacePath.trim()) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await workspacesApi.create(workspacePath);
      if (!result.ok || hasApiErrorPayload(result.data)) {
        throw new Error(readApiErrorMessage(result.data, "Failed to add workspace"));
      }

      setWorkspacePath("");
      setSelectedWorkspaceId(result.data.id);
      await Promise.all([loadOverview(), loadAgentSessions()]);
    } catch (caughtError) {
      setError(toMessage(caughtError));
    } finally {
      setLoading(false);
    }
  }

  async function handlePickWorkspace() {
    setPickingWorkspace(true);
    setError("");

    try {
      const result = await workspacesApi.pick();
      if (!result.ok) {
        throw new Error(result.data.error ?? "Failed to open folder picker");
      }

      if ("cancelled" in result.data && result.data.cancelled) {
        return;
      }

      if ("workspace" in result.data && result.data.workspace) {
        setSelectedWorkspaceId(result.data.workspace.id);
        await Promise.all([loadOverview(), loadAgentSessions()]);
      }
    } catch (caughtError) {
      setError(toMessage(caughtError));
    } finally {
      setPickingWorkspace(false);
    }
  }

  async function handleStartSession(event: FormEvent<HTMLFormElement>) {
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

  async function handleAttachAgentSession() {
    if (!selectedAgentSessionId) {
      return null;
    }

    const attachingAgentSessionId = selectedAgentSessionId;
    const attachOperation = beginAgentAttachOperation(
      agentAttachOperationRef,
      attachingAgentSessionId
    );
    const attachIsCurrent = () => isAgentAttachOperationCurrent(
      agentAttachOperationRef,
      selectedAgentSessionIdRef,
      attachOperation
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
      if (!attachIsCurrent()) {
        return null;
      }
      if (!result.ok || hasApiErrorPayload(result.data)) {
        throw new Error(readApiErrorMessage(result.data, "Failed to attach agent session"));
      }

      const attachedSession = isSessionCommandAccepted(result.data)
        ? await loadSession(result.data.sessionId, { sessionView: "chat" })
        : result.data;
      if (!attachIsCurrent()) return null;
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
      if (attachIsCurrent()) {
        setError(toMessage(caughtError));
      }
      return null;
    } finally {
      if (attachIsCurrent()) {
        setAttachingAgentSessionId("");
      }
    }
  }

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
    handleRefreshGit,
    handleSetPreview,
    handleStopPreview
  } = useDashboardPreviewCommandHandlers({
    selectedSessionId,
    selectedSession,
    selectedSessionIdRef,
    selectedSessionSelectionEpochRef,
    previewPort,
    setSelectedSession,
    setError,
    loadOverview
  });

  async function handleStopSession() {
    function applyStoppedSession(stoppedSession: SessionDetail) {
      if (selectedSession?.id === stoppedSession.id) {
        setSelectedSession(stoppedSession);
      }
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

    if (!selectedSessionId) {
      return false;
    }

    const stoppingSessionId = selectedSessionId;
    const selectionOperation = captureSessionSelectionOperation(
      stoppingSessionId,
      selectedSessionSelectionEpochRef
    );
    const selectionIsCurrent = () => isSessionSelectionOperationCurrent(
      selectedSessionIdRef,
      selectedSessionSelectionEpochRef,
      selectionOperation
    );
    const pendingCommand = acquirePendingCloudCommand(
      "managed.stop",
      stoppingSessionId
    );
    const result = await sessionsApi.stop(stoppingSessionId, pendingCommand.commandId);
    const definitive = clearPendingCloudCommandForResult(pendingCommand, result);
    if (!selectionIsCurrent()) {
      return false;
    }
    if (result.ok && isCloudControlReceipt(result.data, stoppingSessionId)) {
      const recoveredSession = await recoverStoppedManagedSession(
        stoppingSessionId,
        loadSession
      );
      if (!selectionIsCurrent()) return false;
      if (!recoveredSession) {
        setError("Session stop completed, but DeskCue could not load the stopped session.");
        return false;
      }
      return applyStoppedSession(recoveredSession);
    }
    if (!result.ok || hasApiErrorPayload(result.data)) {
      if (!definitive) {
        const recoveredSession = await recoverStoppedManagedSession(
          stoppingSessionId,
          loadSession
        );
        if (!selectionIsCurrent()) return false;
        if (recoveredSession) {
          clearPendingCloudCommand(pendingCommand);
          return applyStoppedSession(recoveredSession);
        }
      }
      setError(readApiErrorMessage(result.data, "Failed to stop session"));
      return false;
    }

    const stoppedSession = mergeSessionUpdate(selectedSession, result.data);
    return applyStoppedSession(stoppedSession);
  }

  return {
    handleAddWorkspace,
    handlePickWorkspace,
    handleStartSession,
    handleAttachAgentSession,
    handleSendInput,
    handleStopSession,
    handleChangePreviewNetworkMode,
    handleRefreshGit,
    handleSetPreview,
    handleStopPreview
  };
}

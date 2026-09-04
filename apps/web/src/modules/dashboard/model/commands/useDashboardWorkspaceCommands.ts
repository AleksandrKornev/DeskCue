import {
  useCallback,
  useState
} from "react";
import type { SubmitEvent } from "react";

import type { AgentSessionSummary, OverviewResponse } from "@deskcue/protocol";
import {
  isConnectionEpochCurrent,
  readConnectionEpoch
} from "@api/connection/events";
import { workspacesApi } from "@api/endpoint/workspaces/endpoints";
import {
  hasApiErrorPayload,
  readApiErrorMessage
} from "@api/transport/httpClient";
import { toMessage } from "@lib/format";
import type { WorkspaceActionResult } from "@modules/dashboard/model/dashboardViewModel";

type UseDashboardWorkspaceCommandsArgs = {
  workspacePath: string;
  getWorkspacePath: () => string;
  setWorkspacePath: (value: string) => void;
  setSelectedWorkspaceId: (value: string) => void;
  loadOverview: () => Promise<OverviewResponse>;
  loadAgentSessions: () => Promise<AgentSessionSummary[]>;
};

export function useDashboardWorkspaceCommands({
  workspacePath,
  getWorkspacePath,
  setWorkspacePath,
  setSelectedWorkspaceId,
  loadOverview,
  loadAgentSessions
}: UseDashboardWorkspaceCommandsArgs) {
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspacePicking, setWorkspacePicking] = useState(false);

  const handleAddWorkspace = useCallback(async (
    event: SubmitEvent<HTMLFormElement>
  ): Promise<WorkspaceActionResult> => {
    const submittedWorkspacePath = workspacePath;
    const connectionEpoch = readConnectionEpoch();

    event.preventDefault();
    if (!submittedWorkspacePath.trim()) {
      return { status: "failed", error: "Choose a readable folder." };
    }

    setWorkspaceLoading(true);

    try {
      const result = await workspacesApi.create(submittedWorkspacePath);

      if (!isConnectionEpochCurrent(connectionEpoch)) return { status: "cancelled" };

      if (!result.ok || hasApiErrorPayload(result.data)) {
        throw new Error(readApiErrorMessage(result.data, "Failed to add workspace"));
      }

      if (getWorkspacePath() === submittedWorkspacePath) setWorkspacePath("");
      setSelectedWorkspaceId(result.data.id);
      await Promise.allSettled([loadOverview(), loadAgentSessions()]);

      return { status: "created" };
    } catch (caughtError) {
      if (!isConnectionEpochCurrent(connectionEpoch)) return { status: "cancelled" };

      return { status: "failed", error: toMessage(caughtError) };
    } finally {
      setWorkspaceLoading(false);
    }
  }, [
    loadAgentSessions,
    loadOverview,
    getWorkspacePath,
    setSelectedWorkspaceId,
    setWorkspacePath,
    workspacePath
  ]);

  const handlePickWorkspace = useCallback(async (): Promise<WorkspaceActionResult> => {
    const connectionEpoch = readConnectionEpoch();

    setWorkspacePicking(true);

    try {
      const result = await workspacesApi.pick();

      if (!isConnectionEpochCurrent(connectionEpoch)) return { status: "cancelled" };

      if (!result.ok) {
        throw new Error(result.data.error ?? "Failed to open folder picker");
      }

      if ("cancelled" in result.data && result.data.cancelled) {
        return { status: "cancelled" };
      }

      if ("workspace" in result.data && result.data.workspace) {
        setSelectedWorkspaceId(result.data.workspace.id);
        await Promise.allSettled([loadOverview(), loadAgentSessions()]);

        return { status: "created" };
      }

      return { status: "failed", error: "Folder picker did not return a workspace." };
    } catch (caughtError) {
      if (!isConnectionEpochCurrent(connectionEpoch)) return { status: "cancelled" };

      return { status: "failed", error: toMessage(caughtError) };
    } finally {
      setWorkspacePicking(false);
    }
  }, [loadAgentSessions, loadOverview, setSelectedWorkspaceId]);

  return {
    handleAddWorkspace,
    handlePickWorkspace,
    workspaceLoading,
    workspacePicking
  };
}

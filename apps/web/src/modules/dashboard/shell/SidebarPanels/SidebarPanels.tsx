import {
  useEffect,
  useRef,
  useState
} from "react";

import type { RuntimeSummary } from "@deskcue/protocol";
import { dashboardApi } from "@api/endpoint/dashboard/endpoints";
import { getDeskCueRuntime } from "@runtime";

import { AGENT_CLI_IDS, MODEL_RUNTIME_IDS } from "./constants";
import { KnownWorkspacesPanel } from "./KnownWorkspacesPanel/index";
import { LocalRuntimesPanel } from "./LocalRuntimesPanel/index";
import { ManualRunnerPanel } from "./ManualRunnerPanel/index";
import styles from "./styles.module.scss";
import { ToolRow } from "./ToolRow";
import type { SidebarPanelsProps } from "./types";

export function SidebarPanels(props: SidebarPanelsProps) {
  const {
    agentCliRuntimes,
    workspacePath,
    loading,
    pickingWorkspace,
    canOpenNativeDialogs,
    selectedWorkspaceId,
    workspaces,
    command,
    runtimes,
    isBootstrapping,
    compact = false,
    presentation = "cards",
    onChangeWorkspacePath,
    onPickWorkspace,
    onAddWorkspace,
    onSelectWorkspace,
    onChangeCommand,
    onStartSession
  } = props;

  const [manualOpen, setManualOpen] = useState(false);
  const [runtimesOpen, setRuntimesOpen] = useState(false);
  const [agentClisOpen, setAgentClisOpen] = useState(false);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [lmStudioRuntime, setLmStudioRuntime] = useState<RuntimeSummary | null>(null);
  const [lmStudioControlMessage, setLmStudioControlMessage] = useState<string | null>(null);
  const [startingLmStudio, setStartingLmStudio] = useState(false);
  const lmStudioRefreshGenerationRef = useRef(0);
  const lmStudioRefreshTimerRef = useRef<number | null>(null);
  const toggleManualOpen = () => setManualOpen((current) => !current);
  const toggleRuntimesOpen = () => setRuntimesOpen((current) => !current);
  const toggleAgentClisOpen = () => setAgentClisOpen((current) => !current);
  const toggleWorkspacesOpen = () => setWorkspacesOpen((current) => !current);
  const modelRuntimes = runtimes
    .filter((runtime) => MODEL_RUNTIME_IDS.has(runtime.id))
    .map((runtime) => runtime.id === "lm-studio" && lmStudioRuntime ? lmStudioRuntime : runtime);
  const agentCliRuntimeRows =
    agentCliRuntimes ?? runtimes.filter((runtime) => AGENT_CLI_IDS.has(runtime.id));
  const features = getDeskCueRuntime().features;

  useEffect(() => () => {
    lmStudioRefreshGenerationRef.current += 1;
    if (lmStudioRefreshTimerRef.current !== null) {
      window.clearTimeout(lmStudioRefreshTimerRef.current);
      lmStudioRefreshTimerRef.current = null;
    }
  }, []);

  const startLmStudio = async () => {
    const generation = lmStudioRefreshGenerationRef.current + 1;
    lmStudioRefreshGenerationRef.current = generation;
    if (lmStudioRefreshTimerRef.current !== null) {
      window.clearTimeout(lmStudioRefreshTimerRef.current);
      lmStudioRefreshTimerRef.current = null;
    }
    setStartingLmStudio(true);
    setLmStudioControlMessage(null);

    try {
      const result = await dashboardApi.startLmStudioServer();
      if (lmStudioRefreshGenerationRef.current !== generation) {
        return;
      }
      setLmStudioRuntime(result.runtime);
      setLmStudioControlMessage(
        result.alreadyRunning
          ? "Local Server is already running"
          : "Local Server start requested. Checking availability…"
      );
      lmStudioRefreshTimerRef.current = window.setTimeout(() => {
        lmStudioRefreshTimerRef.current = null;
        dashboardApi.getRuntimes()
          .then((nextRuntimes) => {
            if (lmStudioRefreshGenerationRef.current !== generation) {
              return;
            }
            const nextLmStudioRuntime = nextRuntimes.find((runtime) => runtime.id === "lm-studio");
            if (!nextLmStudioRuntime) {
              return;
            }

            setLmStudioRuntime(nextLmStudioRuntime);
            setLmStudioControlMessage(
              nextLmStudioRuntime.running
                ? "Local Server is ready"
                : "Local Server is still starting. Refresh diagnostics in a moment"
            );
          })
          .catch(() => {
            if (lmStudioRefreshGenerationRef.current === generation) {
              setLmStudioControlMessage("Local Server start was requested. Diagnostics refresh failed");
            }
          });
      }, 1_200);
    } catch (error) {
      if (lmStudioRefreshGenerationRef.current === generation) {
        setLmStudioControlMessage(error instanceof Error ? error.message : "Failed to start LM Studio Local Server");
      }
    } finally {
      if (lmStudioRefreshGenerationRef.current === generation) {
        setStartingLmStudio(false);
      }
    }
  };

  if (
    !features.manualRunner &&
    !features.localRuntimes &&
    !features.workspaceManagement
  ) {
    return null;
  }

  if (presentation === "list") {
    return (
      <>
        <div className={styles.toolList}>
        <ToolRow
          active={manualOpen}
          icon="manual"
          title="Manual controls"
          subtitle="Run commands manually"
          onClick={toggleManualOpen}
        />
        {manualOpen ? (
          <ManualRunnerPanel
            canOpenNativeDialogs={canOpenNativeDialogs}
            command={command}
            compact={compact}
            isOpen
            isTriggerHidden
            loading={loading}
            pickingWorkspace={pickingWorkspace}
            selectedWorkspaceId={selectedWorkspaceId}
            workspacePath={workspacePath}
            workspaces={workspaces}
            onAddWorkspace={onAddWorkspace}
            onChangeCommand={onChangeCommand}
            onChangeWorkspacePath={onChangeWorkspacePath}
            onPickWorkspace={onPickWorkspace}
            onSelectWorkspace={onSelectWorkspace}
            onStartSession={onStartSession}
            onToggleOpen={toggleManualOpen}
          />
        ) : null}

        <ToolRow
          active={runtimesOpen}
          badge={String(modelRuntimes.length)}
          icon="runtimes"
          title="Local runtimes"
          subtitle="Model server diagnostics"
          onClick={toggleRuntimesOpen}
        />
        {runtimesOpen ? (
          <LocalRuntimesPanel
            compact={compact}
            isBootstrapping={isBootstrapping}
            isOpen
            isTriggerHidden
            runtimes={modelRuntimes}
            subtitle="Diagnostics for local model servers"
            isStartingLmStudio={startingLmStudio}
            lmStudioControlMessage={lmStudioControlMessage}
            onStartLmStudio={() => { void startLmStudio(); }}
            onToggleOpen={toggleRuntimesOpen}
          />
        ) : null}

        <ToolRow
          active={agentClisOpen}
          badge={String(agentCliRuntimeRows.length)}
          icon="agents"
          title="Agent CLIs"
          subtitle="Parsed chats and CLI status"
          onClick={toggleAgentClisOpen}
        />
        {agentClisOpen ? (
          <LocalRuntimesPanel
            compact={compact}
            emptyText="No agent CLI detected yet"
            hideLabel="Hide agent CLIs"
            isBootstrapping={isBootstrapping}
            isOpen
            isTriggerHidden
            runtimes={agentCliRuntimeRows}
            showLabel="Show agent CLIs"
            showStatusIndicator={false}
            subtitle="Parsed local chats and installed CLI status"
            title="Agent CLIs"
            onToggleOpen={toggleAgentClisOpen}
          />
        ) : null}

        <ToolRow
          active={workspacesOpen}
          badge={String(workspaces.length)}
          icon="workspaces"
          title="Known workspaces"
          subtitle="Manage local workspace paths"
          onClick={toggleWorkspacesOpen}
        />
        {workspacesOpen ? (
          <KnownWorkspacesPanel
            compact={compact}
            isBootstrapping={isBootstrapping}
            isOpen
            isTriggerHidden
            selectedWorkspaceId={selectedWorkspaceId}
            workspaces={workspaces}
            onSelectWorkspace={onSelectWorkspace}
            onToggleOpen={toggleWorkspacesOpen}
          />
        ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <ManualRunnerPanel
        canOpenNativeDialogs={canOpenNativeDialogs}
        command={command}
        compact={compact}
        isOpen={manualOpen}
        loading={loading}
        pickingWorkspace={pickingWorkspace}
        selectedWorkspaceId={selectedWorkspaceId}
        workspacePath={workspacePath}
        workspaces={workspaces}
        onAddWorkspace={onAddWorkspace}
        onChangeCommand={onChangeCommand}
        onChangeWorkspacePath={onChangeWorkspacePath}
        onPickWorkspace={onPickWorkspace}
        onSelectWorkspace={onSelectWorkspace}
        onStartSession={onStartSession}
        onToggleOpen={toggleManualOpen}
      />

      <LocalRuntimesPanel
        compact={compact}
        isBootstrapping={isBootstrapping}
        isOpen={runtimesOpen}
        runtimes={modelRuntimes}
        subtitle="Diagnostics for local model servers on this machine"
        isStartingLmStudio={startingLmStudio}
        lmStudioControlMessage={lmStudioControlMessage}
        onStartLmStudio={() => { void startLmStudio(); }}
        onToggleOpen={toggleRuntimesOpen}
      />

      <LocalRuntimesPanel
        compact={compact}
        emptyText="No agent CLI detected yet"
        hideLabel="Hide agent CLIs"
        isBootstrapping={isBootstrapping}
        isOpen={agentClisOpen}
        runtimes={agentCliRuntimeRows}
        showLabel="Show agent CLIs"
        showStatusIndicator={false}
        subtitle="Parsed local chats and installed CLI status"
        title="Agent CLIs"
        onToggleOpen={toggleAgentClisOpen}
      />

      <KnownWorkspacesPanel
        compact={compact}
        isBootstrapping={isBootstrapping}
        isOpen={workspacesOpen}
        selectedWorkspaceId={selectedWorkspaceId}
        workspaces={workspaces}
        onSelectWorkspace={onSelectWorkspace}
        onToggleOpen={toggleWorkspacesOpen}
      />

    </>
  );
}

import { act, fireEvent, render, renderHook } from "@testing-library/react";
import type { SubmitEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emitConnectionConfigChangedEvent } from "@api/connection/events";

const workspaceApiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  pick: vi.fn()
}));

vi.mock("@api/endpoint/workspaces/endpoints", () => ({
  workspacesApi: workspaceApiMocks
}));

import { useDashboardWorkspaceCommands } from "./useDashboardWorkspaceCommands";

function submitWithReactEvent<Result>(
  action: (event: SubmitEvent<HTMLFormElement>) => Result
): Result {
  let result!: Result;
  let submitted = false;
  const view = render(
    <form
      aria-label="Test submit"
      onSubmit={(event) => {
        result = action(event);
        submitted = true;
      }}
    >
      <button type="submit">Submit</button>
    </form>
  );

  const form = view.getByRole("form", { name: "Test submit" });
  const submitter = view.getByRole("button", { name: "Submit" });

  fireEvent(form, new globalThis.SubmitEvent("submit", {
    bubbles: true,
    cancelable: true,
    submitter
  }));
  view.unmount();
  if (!submitted) throw new Error("Expected the React submit handler to run");

  return result;
}

function createHarness(workspacePath = "D:\\work\\DeskCue") {
  return {
    args: {
      workspacePath,
      getWorkspacePath: vi.fn(() => workspacePath),
      setWorkspacePath: vi.fn(),
      setSelectedWorkspaceId: vi.fn(),
      loadOverview: vi.fn().mockResolvedValue({}),
      loadAgentSessions: vi.fn().mockResolvedValue([])
    }
  };
}

describe("useDashboardWorkspaceCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a scoped failure without reloading dashboard data", async () => {
    workspaceApiMocks.create.mockResolvedValue({
      ok: false,
      data: { error: "Workspace path is not readable." }
    });
    const harness = createHarness();
    const { result } = renderHook(() => useDashboardWorkspaceCommands(harness.args));

    const submission = submitWithReactEvent(result.current.handleAddWorkspace);
    const outcome = await act(() => submission);

    expect(outcome).toEqual({ status: "failed", error: "Workspace path is not readable." });
    expect(harness.args.loadOverview).not.toHaveBeenCalled();
    expect(harness.args.loadAgentSessions).not.toHaveBeenCalled();
    expect(result.current.workspaceLoading).toBe(false);
  });

  it("registers a manual path and refreshes workspace-backed data", async () => {
    workspaceApiMocks.create.mockResolvedValue({
      ok: true,
      data: { id: "workspace-1" }
    });
    const harness = createHarness();
    const { result } = renderHook(() => useDashboardWorkspaceCommands(harness.args));

    const submission = submitWithReactEvent(result.current.handleAddWorkspace);
    const outcome = await act(() => submission);

    expect(outcome).toEqual({ status: "created" });
    expect(harness.args.setWorkspacePath).toHaveBeenCalledWith("");
    expect(harness.args.setSelectedWorkspaceId).toHaveBeenCalledWith("workspace-1");
    expect(harness.args.loadOverview).toHaveBeenCalledOnce();
    expect(harness.args.loadAgentSessions).toHaveBeenCalledOnce();
  });

  it("does not clear a newer draft when an earlier registration succeeds", async () => {
    let resolveCreate!: (value: unknown) => void;
    let currentWorkspacePath = "D:\\work\\first-workspace";

    workspaceApiMocks.create.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));

    const harness = createHarness(currentWorkspacePath);

    harness.args.getWorkspacePath.mockImplementation(() => currentWorkspacePath);
    const { result } = renderHook(() => useDashboardWorkspaceCommands(harness.args));
    const action = submitWithReactEvent(result.current.handleAddWorkspace);

    currentWorkspacePath = "D:\\work\\new-draft";

    await act(async () => {
      resolveCreate({ ok: true, data: { id: "workspace-late-success" } });
      await action;
    });

    expect(harness.args.setWorkspacePath).not.toHaveBeenCalled();
    expect(harness.args.setSelectedWorkspaceId).toHaveBeenCalledWith("workspace-late-success");
  });

  it("ignores a registration response from a previous connection", async () => {
    let resolveCreate!: (value: unknown) => void;

    workspaceApiMocks.create.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));

    const harness = createHarness();
    const { result } = renderHook(() => useDashboardWorkspaceCommands(harness.args));
    const action = submitWithReactEvent(result.current.handleAddWorkspace);

    act(() => {
      emitConnectionConfigChangedEvent();
    });
    await act(async () => {
      resolveCreate({ ok: true, data: { id: "stale-workspace" } });
      await action;
    });

    expect(harness.args.setWorkspacePath).not.toHaveBeenCalled();
    expect(harness.args.setSelectedWorkspaceId).not.toHaveBeenCalled();
    expect(harness.args.loadOverview).not.toHaveBeenCalled();
    expect(harness.args.loadAgentSessions).not.toHaveBeenCalled();
  });

  it("keeps registration successful when a follow-up refresh rejects", async () => {
    workspaceApiMocks.create.mockResolvedValue({
      ok: true,
      data: { id: "workspace-refresh" }
    });
    const harness = createHarness();
    const { result } = renderHook(() => useDashboardWorkspaceCommands(harness.args));

    harness.args.loadOverview.mockRejectedValue(new Error("Refresh failed"));

    const submission = submitWithReactEvent(result.current.handleAddWorkspace);
    const outcome = await act(() => submission);

    expect(outcome).toEqual({ status: "created" });
    expect(harness.args.setSelectedWorkspaceId).toHaveBeenCalledWith("workspace-refresh");
  });

  it("distinguishes picker cancellation from successful registration", async () => {
    workspaceApiMocks.pick.mockResolvedValue({ ok: true, data: { cancelled: true } });
    const harness = createHarness();
    const { result } = renderHook(() => useDashboardWorkspaceCommands(harness.args));

    const outcome = await act(() => result.current.handlePickWorkspace());

    expect(outcome).toEqual({ status: "cancelled" });
    expect(harness.args.setSelectedWorkspaceId).not.toHaveBeenCalled();
    expect(harness.args.loadOverview).not.toHaveBeenCalled();
  });

  it("ignores a picker response from a previous connection", async () => {
    let resolvePick!: (value: unknown) => void;

    workspaceApiMocks.pick.mockReturnValue(new Promise((resolve) => {
      resolvePick = resolve;
    }));

    const harness = createHarness();
    const { result } = renderHook(() => useDashboardWorkspaceCommands(harness.args));
    let action!: Promise<unknown>;

    act(() => {
      action = result.current.handlePickWorkspace();
      emitConnectionConfigChangedEvent();
    });
    await act(async () => {
      resolvePick({ ok: true, data: { workspace: { id: "stale-workspace" } } });
      await action;
    });

    expect(harness.args.setSelectedWorkspaceId).not.toHaveBeenCalled();
    expect(harness.args.loadOverview).not.toHaveBeenCalled();
    expect(harness.args.loadAgentSessions).not.toHaveBeenCalled();
  });

  it("keeps workspace busy state independent while registration is pending", async () => {
    let resolveCreate!: (value: unknown) => void;

    workspaceApiMocks.create.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve;
    }));

    const harness = createHarness();
    const { result } = renderHook(() => useDashboardWorkspaceCommands(harness.args));
    const action = submitWithReactEvent(result.current.handleAddWorkspace);

    expect(result.current.workspaceLoading).toBe(true);
    expect(result.current.workspacePicking).toBe(false);

    await act(async () => {
      resolveCreate({ ok: true, data: { id: "workspace-2" } });
      await action;
    });

    expect(result.current.workspaceLoading).toBe(false);
  });
});

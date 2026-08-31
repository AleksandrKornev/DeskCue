import { describe, expect, it, vi } from "vitest";

import type { DaemonSettingsResponse } from "@deskcue/protocol";

import { DaemonSettingsStore } from "./store";

function createSettings(): DaemonSettingsResponse {
  return {
    agentDataRoots: {
      claudeHome: "C:\\claude",
      codexHome: "C:\\codex",
      lmStudioHome: "C:\\lmstudio"
    },
    allowedOrigins: [],
    authRequired: true,
    pairingHosts: [],
    publicHost: null,
    runtimeEndpoints: {
      lmStudioEndpoint: "http://127.0.0.1:1234",
      ollamaEndpoint: "http://127.0.0.1:11434"
    },
    storageMaxMb: 50
  } as unknown as DaemonSettingsResponse;
}

function createController() {
  return {
    fetchSecurityStatus: vi.fn().mockResolvedValue({}),
    getDaemonSettings: vi.fn(),
    notifyReset: vi.fn(),
    notifySaved: vi.fn(),
    requestResetConfirmation: vi.fn(),
    resetDaemonSettings: vi.fn(),
    updateDaemonSettings: vi.fn()
  };
}

describe("DaemonSettingsStore UI revisions", () => {
  it("publishes a save-success revision only after a successful response", async () => {
    const controller = createController();
    const settings = createSettings();
    const store = new DaemonSettingsStore(controller);

    store.syncDaemonSettings(settings);
    controller.updateDaemonSettings.mockResolvedValue({ data: settings, ok: true });

    await store.onSaveDaemonSettings();

    expect(store.settingsSaveSuccessRevision).toBe(1);
    expect(controller.notifySaved).toHaveBeenCalledOnce();
  });

  it("keeps the success revision unchanged after a failed save", async () => {
    const controller = createController();
    const store = new DaemonSettingsStore(controller);

    store.syncDaemonSettings(createSettings());
    controller.updateDaemonSettings.mockResolvedValue({
      data: { error: "invalid endpoint" },
      ok: false
    });

    await store.onSaveDaemonSettings();

    expect(store.settingsSaveSuccessRevision).toBe(0);
    expect(store.daemonSettingsStatus).toEqual({
      kind: "error",
      message: "invalid endpoint"
    });
  });

  it("increments the settings connection epoch on reset", () => {
    const store = new DaemonSettingsStore(createController());

    store.resetForConnectionChange();

    expect(store.settingsConnectionRevision).toBe(1);
  });

  it("adopts normalized submitted values while preserving edits made after submission", async () => {
    let resolveSave!: (result: { data: ReturnType<typeof createSettings>; ok: true }) => void;
    const controller = createController();
    const settings = createSettings();
    const pendingSave = new Promise<{ data: ReturnType<typeof createSettings>; ok: true }>((resolve) => {
      resolveSave = resolve;
    });
    const store = new DaemonSettingsStore(controller);

    store.syncDaemonSettings(settings);
    controller.updateDaemonSettings.mockReturnValue(pendingSave);
    store.onRuntimeEndpointChange("ollamaEndpoint", "http://raw-submitted");

    const saving = store.onSaveDaemonSettings();

    store.onRuntimeEndpointChange("lmStudioEndpoint", "http://post-submit-edit");
    resolveSave({
      data: {
        ...settings,
        runtimeEndpoints: {
          lmStudioEndpoint: "http://normalized-lm-studio",
          ollamaEndpoint: "http://normalized-ollama"
        }
      },
      ok: true
    });
    await saving;

    expect(store.daemonSettingsDraft?.runtimeEndpoints).toEqual({
      lmStudioEndpoint: "http://post-submit-edit",
      ollamaEndpoint: "http://normalized-ollama"
    });
  });

  it("merges a partial server update without erasing edits owned by another tab", () => {
    const store = new DaemonSettingsStore(createController());
    const settings = createSettings();
    const nextSettings = {
      ...(settings as object),
      storageMaxMb: 100
    } as never;

    store.syncDaemonSettings(settings);
    store.onRuntimeEndpointChange("ollamaEndpoint", "http://127.0.0.1:22434");
    store.syncDaemonSettingsPreservingDraft(nextSettings);

    expect(store.daemonSettings?.storageMaxMb).toBe(100);
    expect(store.daemonSettingsDraft?.storageMaxMb).toBe(100);
    expect(store.daemonSettingsDraft?.runtimeEndpoints.ollamaEndpoint)
      .toBe("http://127.0.0.1:22434");
  });

  it("resets pre-confirm edits while preserving granular edits made after confirmation", async () => {
    let resolveReset!: (result: { data: ReturnType<typeof createSettings>; ok: true }) => void;
    const controller = createController();
    const settings = createSettings();
    const pendingReset = new Promise<{ data: ReturnType<typeof createSettings>; ok: true }>((resolve) => {
      resolveReset = resolve;
    });
    const store = new DaemonSettingsStore(controller);

    controller.requestResetConfirmation.mockResolvedValue(true);
    controller.resetDaemonSettings.mockReturnValue(pendingReset);
    store.syncDaemonSettings(settings);
    store.onRuntimeEndpointChange("ollamaEndpoint", "http://pre-confirm-unsaved");

    const resetting = store.onResetDaemonSettings();

    await Promise.resolve();
    store.onRuntimeEndpointChange("lmStudioEndpoint", "http://post-confirm-edit");
    resolveReset({
      data: {
        ...settings,
        runtimeEndpoints: {
          lmStudioEndpoint: "http://reset-lm-studio",
          ollamaEndpoint: "http://reset-ollama"
        }
      },
      ok: true
    });
    await resetting;

    expect(store.daemonSettingsDraft?.runtimeEndpoints).toEqual({
      lmStudioEndpoint: "http://post-confirm-edit",
      ollamaEndpoint: "http://reset-ollama"
    });
  });
});

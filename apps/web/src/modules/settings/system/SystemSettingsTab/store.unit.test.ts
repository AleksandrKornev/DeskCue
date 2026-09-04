import { describe, expect, it, vi } from "vitest";

import { SystemSettingsStore } from "./store";

function createDependencies() {
  return {
    daemonSettings: {
      agentDataRoots: {
        claudeHome: "C:\\claude",
        codexHome: "C:\\codex",
        lmStudioHome: "C:\\lmstudio"
      },
      runtimeEndpoints: {
        lmStudioEndpoint: "http://127.0.0.1:1234",
        ollamaEndpoint: "http://127.0.0.1:11434"
      }
    } as never,
    daemonSettingsDraft: {
      agentDataRoots: {
        claudeHome: "C:\\claude",
        codexHome: "C:\\codex",
        lmStudioHome: "C:\\lmstudio"
      },
      runtimeEndpoints: {
        lmStudioEndpoint: "http://127.0.0.1:1234",
        ollamaEndpoint: "http://127.0.0.1:11434"
      }
    },
    daemonSettingsStatus: null,
    onAgentDataRootChange: vi.fn(),
    onResetDaemonSettings: vi.fn(),
    onRuntimeEndpointChange: vi.fn(),
    onSaveDaemonSettings: vi.fn(),
    resettingDaemonSettings: false,
    savingDaemonSettings: false,
    securityStatus: null,
    securityStatusMessage: "",
    settingsConnectionRevision: 0,
    settingsMutationPending: false,
    settingsSaveSuccessRevision: 0
  };
}

describe("SystemSettingsStore derived UI state", () => {
  it("tracks changes only in the fields owned by the System tab", () => {
    const store = new SystemSettingsStore();
    const dependencies = createDependencies();

    store.updateDependencies(dependencies);

    expect(store.systemSettingsDirty).toBe(false);

    store.updateDependencies({
      ...dependencies,
      daemonSettingsDraft: {
        ...dependencies.daemonSettingsDraft,
        runtimeEndpoints: {
          ...dependencies.daemonSettingsDraft.runtimeEndpoints,
          ollamaEndpoint: "http://127.0.0.1:22434"
        }
      }
    });

    expect(store.systemSettingsDirty).toBe(true);
  });

  it("exposes save/reset pending state", () => {
    const store = new SystemSettingsStore();

    store.updateDependencies({
      ...createDependencies(),
      savingDaemonSettings: true,
      settingsMutationPending: true
    });

    expect(store.systemSettingsOperationPending).toBe(true);
  });
});

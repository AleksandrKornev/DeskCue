import type { DaemonSettingsResponse } from "@deskcue/protocol";

export type SystemSettingsDraft = {
  agentDataRoots: DaemonSettingsResponse["agentDataRoots"];
  runtimeEndpoints: DaemonSettingsResponse["runtimeEndpoints"];
};

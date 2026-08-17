import type { DaemonSettingsResponse } from "@deskcue/protocol";

export type SettingsDraft = {
  authRequired: boolean;
  publicHost: string;
  pairingHosts: string[];
  allowedOriginsText: string;
  storageMaxMb: number;
  agentDataRoots: DaemonSettingsResponse["agentDataRoots"];
  runtimeEndpoints: DaemonSettingsResponse["runtimeEndpoints"];
};

export type DaemonSettingsStatus = {
  kind: "error";
  message: string;
} | null;

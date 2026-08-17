export type AdapterSupportLevel = "stable" | "experimental" | "review-only" | "planned";

export interface AdapterCapabilities {
  attach: boolean;
  discover: boolean;
  resume: boolean;
  start: boolean;
}

export type AdapterRuntimeKind = "agent-cli" | "llm-runtime" | "provider-gateway" | "generic-cli";

export interface AdapterMetadata {
  id: string;
  label: string;
  description: string;
  supportLevel: AdapterSupportLevel;
  runtimeKind: AdapterRuntimeKind;
  capabilities: AdapterCapabilities;
}

export interface LaunchSpec {
  command: string;
  cwd: string;
  env?: Record<string, string | undefined>;
}

export interface AgentAdapter {
  id: string;
  label: string;
  description: string;
  canHandle(command: string): boolean;
  normalize(command: string, cwd: string): LaunchSpec;
}

/** Adapter lifecycle state, independent from the HTTP session wire contract. */
export type AdapterSessionStatus =
  | "running"
  | "read_only"
  | "stopped"
  | "done"
  | "failed";

export interface AdapterSessionState {
  status: AdapterSessionStatus;
  rawCommand: string;
  cwd: string;
}

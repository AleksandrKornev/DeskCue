export type DeskCueRuntimeMode = "cloud-machine" | "local" | "remote";

export type DeskCueRuntimeFeatures = {
  accessSettings: boolean;
  cloudConnection: boolean;
  daemonLogs: boolean;
  externalHostProcessControls: boolean;
  /** Workspace file browsing is unavailable unless a remote host opts in explicitly. */
  files?: boolean;
  /** Working-tree refresh is unavailable unless a remote host opts in explicitly. */
  gitRefresh?: boolean;
  localLlmChats: boolean;
  localRuntimes: boolean;
  manualRunner: boolean;
  notifications: boolean;
  preview: boolean;
  previewControl: boolean;
  realtime: boolean;
  sessionCommands: boolean;
  workspaceManagement: boolean;
};

export type DeskCueRuntime = {
  buildAppPath: (path: string) => string;
  buildHttpUrl: (path: string) => string;
  buildWebSocketUrl: (path: string) => string;
  features: DeskCueRuntimeFeatures;
  getAuthorizationToken: () => string | null;
  getCacheScope: () => string | null;
  getRealtimeScope: () => string | null;
  mode: DeskCueRuntimeMode;
  /** Explains why session mutations are unavailable in a host-controlled runtime. */
  sessionCommandsUnavailableReason?: string;
  /**
   * Opens an active managed-session preview using a host-owned transport.
   * Cloud injects this boundary so DeskCue never constructs or embeds a
   * machine-local URL. Standalone DeskCue omits it and keeps its local iframe.
   */
  launchSessionPreview?: (sessionId: string) => Promise<void>;
  onUnauthorized?: () => void;
  readAppPath: (pathname: string) => string;
  routerBasename: string;
};

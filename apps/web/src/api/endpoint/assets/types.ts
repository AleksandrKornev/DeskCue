export type LocalAssetLinkContext = {
  agentSessionId?: string;
  managedSessionId?: string;
  workspaceId?: string;
};

export type BuildLocalAssetUrlOptions = {
  download?: boolean;
};

export type CreateLocalAssetLinkOptions = {
  context?: LocalAssetLinkContext;
  download?: boolean;
  kind?: "file" | "local_image";
  maxBytes?: number;
  signal?: AbortSignal;
};

export type FetchLocalAssetTicketBlobOptions = {
  context?: LocalAssetLinkContext;
  kind?: "file" | "local_image";
  maxBytes?: number;
  signal?: AbortSignal;
};

export type FetchLocalAssetTicketTextOptions = {
  context?: LocalAssetLinkContext;
};

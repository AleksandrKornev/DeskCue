export type LocalAssetLinkContext = {
  agentSessionId?: string;
  managedSessionId?: string;
};

export type BuildLocalAssetUrlOptions = {
  download?: boolean;
};

export type CreateLocalAssetLinkOptions = {
  context?: LocalAssetLinkContext;
  download?: boolean;
  kind?: "file" | "local_image";
};

export type FetchLocalAssetTicketBlobOptions = {
  context?: LocalAssetLinkContext;
  kind?: "file" | "local_image";
};

export type FetchLocalAssetTicketTextOptions = {
  context?: LocalAssetLinkContext;
};

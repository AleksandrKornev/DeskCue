import { getDeskCueRuntime } from "@runtime";

import { isLoopbackHost } from "./configUrls";

export {
  forgetAccessToken,
  getAccessToken,
  getConnectionConfig,
  hasBrowserAccessCredential,
  invalidateConnectionConfigCache,
  isConnectionConfigStorageKey,
  saveConnectionConfig
} from "./configStorage";
export type { ConnectionConfig } from "./configStorage";

export function buildApiUrl(path: string) {
  return getDeskCueRuntime().buildHttpUrl(path);
}

export function buildWebSocketUrl(path: string) {
  return getDeskCueRuntime().buildWebSocketUrl(path);
}

export function isLoopbackBrowserPage() {
  return isLoopbackHost(window.location.hostname);
}

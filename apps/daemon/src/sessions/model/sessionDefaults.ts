import type { PreviewConfig, ReplyState } from "@deskcue/protocol";

export function emptyPreview(): PreviewConfig {
  return {
    port: null,
    active: false,
    targetUrl: null,
    networkMode: "device-direct",
    artifacts: []
  };
}

export function emptyReplyState(): ReplyState {
  return {
    phase: "idle",
    promptText: null,
    requestedAt: null
  };
}

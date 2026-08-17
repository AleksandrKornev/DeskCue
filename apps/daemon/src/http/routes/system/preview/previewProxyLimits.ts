export const PREVIEW_PROXY_LIMITS = {
  connectTimeoutMs: 5_000,
  idleTimeoutMs: 30_000,
  maxConcurrentRequests: 64,
  maxConcurrentRequestsPerOwner: 24,
  maxConcurrentRequestsPerViewer: 12,
  maxConcurrentJavaScriptRewrites: 2,
  maxQueuedJavaScriptRewrites: 24,
  maxConcurrentWebSockets: 32,
  maxConcurrentWebSocketsPerOwner: 12,
  maxConcurrentWebSocketsPerViewer: 4,
  maxRequestBytes: 8 * 1024 * 1024,
  maxResponseBytes: 64 * 1024 * 1024,
  maxWebSocketBufferedBytes: 1024 * 1024,
  maxWebSocketMessageBytes: 1024 * 1024
} as const;

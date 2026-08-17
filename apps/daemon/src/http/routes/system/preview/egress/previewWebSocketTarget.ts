export type PreviewWebSocketTargetUrls = {
  httpUrl: URL;
  websocketUrl: URL;
};

export function resolvePreviewWebSocketTargetUrls(target: URL): PreviewWebSocketTargetUrls {
  const websocketUrl = new URL(target);
  if (websocketUrl.protocol === "http:" || websocketUrl.protocol === "ws:") {
    websocketUrl.protocol = "ws:";
  } else if (websocketUrl.protocol === "https:" || websocketUrl.protocol === "wss:") {
    websocketUrl.protocol = "wss:";
  } else {
    throw new Error("Preview WebSocket target is invalid.");
  }

  const httpUrl = new URL(websocketUrl);
  httpUrl.protocol = websocketUrl.protocol === "wss:" ? "https:" : "http:";
  return { httpUrl, websocketUrl };
}

export const PREVIEW_LOOPBACK_HOSTNAME = "localhost";

export function buildPreviewLoopbackOrigin(port: number) {
  return `http://${PREVIEW_LOOPBACK_HOSTNAME}:${port}`;
}

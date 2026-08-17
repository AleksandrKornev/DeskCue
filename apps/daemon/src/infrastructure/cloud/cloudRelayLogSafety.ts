/** Never derive daemon log fields from a Cloud-controlled WebSocket close reason. */
export function toSafeCloudRelayCloseReasonCode(reason: Buffer): string {
  return reason.byteLength === 0 ? "unreported" : "remote_reason_redacted";
}

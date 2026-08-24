export function toCloudErrorCode(error: unknown) {
  if (error instanceof Error) {
    if (/^(?:capabilities|connection|enrollment)_[a-z0-9_]+$/.test(error.message)) return error.message;
    if (error.name === "AbortError") return "cloud_http_timeout";
  }

  return "cloud_transport_error";
}

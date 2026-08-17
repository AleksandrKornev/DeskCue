export function formatManualCommandDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

export function formatManualCommandExit(result: {
  exitCode: number | null;
  signal: string | null;
}) {
  if (typeof result.exitCode === "number") {
    return ` with exit ${result.exitCode}`;
  }

  if (result.signal) {
    return ` with signal ${result.signal}`;
  }

  return "";
}

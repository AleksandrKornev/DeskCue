export function estimateAgentTranscriptPageBytes(value: unknown) {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const MAX_LOCAL_LLM_AGENT_STREAM_RECORD_BYTES = 1024 * 1024;
export const MAX_LOCAL_LLM_ERROR_RESPONSE_BYTES = 64 * 1024;

export async function readBoundedResponseText(
  response: Response,
  maxBytes = MAX_LOCAL_LLM_ERROR_RESPONSE_BYTES
) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  let truncated = false;
  try {
    while (bytesRead <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const remaining = maxBytes - bytesRead;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        bytesRead = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      bytesRead += value.byteLength;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    else reader.releaseLock();
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  return truncated ? `${text}\n[Response body truncated]` : text;
}

async function assertStreamResponse(response: Response) {
  if (response.ok && response.body) return;
  const detail = (await readBoundedResponseText(response)).trim();
  throw new Error(detail || `Local runtime returned HTTP ${response.status}.`);
}

async function readRecords(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  separator: RegExp,
  onRecord: (record: string) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelReader, { once: true });
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      if (Buffer.byteLength(buffer, "utf8") > MAX_LOCAL_LLM_AGENT_STREAM_RECORD_BYTES) {
        throw new Error("Local runtime stream record exceeds the 1 MiB safety limit.");
      }
      const records = buffer.split(separator);
      buffer = records.pop() ?? "";
      for (const record of records) if (record.trim()) onRecord(record);
      if (done) break;
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader);
  }
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The local runtime stream was aborted.", "AbortError");
  }
  const tail = `${buffer}${decoder.decode()}`.trim();
  if (tail) onRecord(tail);
}

export function tryParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function readJsonLines(
  response: Response,
  signal: AbortSignal | undefined,
  onPayload: (payload: unknown) => void
) {
  await assertStreamResponse(response);
  await readRecords(response.body!, signal, /\r?\n/, (record) => {
    const payload = tryParseJson(record);
    if (payload !== null) onPayload(payload);
  });
}

export async function readSse(
  response: Response,
  signal: AbortSignal | undefined,
  onPayload: (payload: unknown) => void
) {
  await assertStreamResponse(response);
  await readRecords(response.body!, signal, /\r?\n\r?\n/, (record) => {
    for (const line of record.split(/\r?\n/)) {
      const value = line.replace(/^data:\s*/, "").trim();
      if (!value || value === "[DONE]") continue;
      const payload = tryParseJson(value);
      if (payload !== null) onPayload(payload);
    }
  });
}

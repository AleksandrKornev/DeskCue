import { AppError } from "#application/errors";

import { readBoundedResponseText, tryParseJson } from "../streamReader.ts";
import type { LocalLlmFetch, LocalLlmGenerationResult } from "../types.ts";
import { trimEndpoint } from "../wireValues.ts";

const MAX_LOCAL_LLM_STREAM_RECORD_BYTES = 1024 * 1024;
// LM Studio's native endpoint otherwise uses its short server default. This
// bounded explicit limit lets regular long chat replies complete.
const LM_STUDIO_NATIVE_MAX_OUTPUT_TOKENS = 2048;

type NativeLmStudioEvent = {
  content?: unknown;
  error?: { message?: unknown };
  result?: { response_id?: unknown };
};

export class NativeLmStudioStreamError extends Error {
  constructor(
    message: string,
    readonly responseId?: string
  ) {
    super(message);
  }
}

function parseNativeSseEvent(value: string) {
  const event = value.match(/^event:\s*([^\r\n]+)/m)?.[1];
  const dataLine = value.match(/^data:\s*(.+)$/m)?.[1];
  const data = dataLine ? tryParseJson(dataLine) : null;
  return event && data && typeof data === "object"
    ? { event, data: data as NativeLmStudioEvent }
    : null;
}

function applyNativeEvent(
  rawEvent: string,
  onDelta: (text: string) => void,
  state: { responseId?: string; streamError?: string }
) {
  const parsed = parseNativeSseEvent(rawEvent);
  if (!parsed) return;
  if (parsed.event === "message.delta" && typeof parsed.data.content === "string") onDelta(parsed.data.content);
  if (parsed.event === "error" && typeof parsed.data.error?.message === "string") {
    state.streamError = parsed.data.error.message;
  }
  if (parsed.event === "chat.end" && typeof parsed.data.result?.response_id === "string") {
    state.responseId = parsed.data.result.response_id;
  }
}

export async function streamNativeLmStudioChat(input: {
  endpoint: string;
  fetch: LocalLlmFetch;
  model: string;
  onDelta: (text: string) => void;
  previousResponseId?: string | null;
  prompt: string;
  signal?: AbortSignal;
}): Promise<LocalLlmGenerationResult> {
  const response = await input.fetch(`${trimEndpoint(input.endpoint)}/api/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      input: input.prompt,
      previous_response_id: input.previousResponseId || undefined,
      max_output_tokens: LM_STUDIO_NATIVE_MAX_OUTPUT_TOKENS,
      store: true,
      stream: true
    }),
    signal: input.signal
  });
  if (!response.ok) {
    const detail = (await readBoundedResponseText(response)).trim();
    throw new AppError(
      "runtime_unavailable",
      detail || `Local runtime returned HTTP ${response.status}.`
    );
  }
  if (!response.body) throw new AppError("runtime_unavailable", "Local runtime returned no response stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state: { responseId?: string; streamError?: string } = {};
  let buffer = "";
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  input.signal?.addEventListener("abort", cancelReader, { once: true });
  try {
    while (!input.signal?.aborted) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      if (Buffer.byteLength(buffer, "utf8") > MAX_LOCAL_LLM_STREAM_RECORD_BYTES) {
        throw new NativeLmStudioStreamError(
          "Local runtime stream record exceeds the 1 MiB safety limit.",
          state.responseId
        );
      }
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) applyNativeEvent(event, input.onDelta, state);
      if (done) break;
    }
  } finally {
    input.signal?.removeEventListener("abort", cancelReader);
  }
  if (input.signal?.aborted) {
    throw input.signal.reason instanceof Error
      ? input.signal.reason
      : new DOMException("The local runtime stream was aborted.", "AbortError");
  }
  const tail = `${buffer}${decoder.decode()}`.trim();
  if (tail) applyNativeEvent(tail, input.onDelta, state);
  if (state.streamError) throw new NativeLmStudioStreamError(state.streamError, state.responseId);
  return { responseId: state.responseId };
}

import { HttpLocalLlmRuntimeAdapterRegistry } from "./transport/localLlmRuntimeAdapterRegistry.ts";
import type {
  LocalLlmChatTransport,
  LocalLlmRuntimeAdapterRegistry
} from "./transport/types.ts";

export { NativeLmStudioStreamError } from "./transport/lmStudio/lmStudioNativeTransport.ts";
export type {
  LocalLlmChatTransport,
  LocalLlmGenerationResult,
  LocalLlmProviderMessage
} from "./transport/types.ts";

/** Translates ordinary chat callbacks into the shared runtime adapter events. */
export class HttpLocalLlmChatTransport implements LocalLlmChatTransport {
  constructor(
    private readonly adapters: LocalLlmRuntimeAdapterRegistry =
    new HttpLocalLlmRuntimeAdapterRegistry()
  ) {}

  async generate({
    messages,
    model,
    onDelta,
    onReasoningDelta,
    previousResponseId,
    runtimeId,
    signal,
    systemPrompt,
    useNativeSession
  }: Parameters<LocalLlmChatTransport["generate"]>[0]) {
    return this.adapters.get(runtimeId).generate({
      messages: [
        ...(systemPrompt ? [{ content: systemPrompt, role: "system" as const }] : []),
        ...messages.map(({ role, text }) => ({ content: text, role }))
      ],
      model,
      onEvent: (event) => {
        if (event.type === "assistant_text_delta") onDelta(event.text);
        if (event.type === "assistant_reasoning_delta") onReasoningDelta?.(event.text);
      },
      previousResponseId,
      signal,
      useNativeSession
    });
  }
}

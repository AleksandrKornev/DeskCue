import type { CreateLocalLlmChatInput, LocalLlmChatMessage } from "@deskcue/protocol";

export type LocalLlmAgentRuntimeId = "ollama" | "lm-studio";

export type LocalLlmProviderMessage = Pick<LocalLlmChatMessage, "role" | "text">;

export type LocalLlmGenerationResult = {
  responseId?: string;
};

/**
 * A completed function call. `argumentsText` is retained for lossless replay,
 * while `arguments` is already JSON-validated and ready for an executor.
 */
export type LocalLlmCompletedToolCall = {
  arguments: Record<string, unknown>;
  argumentsText: string;
  id: string;
  name: string;
};

export type LocalLlmAgentMessage =
  | { content: string; role: "system" | "user" }
  | {
    content: string;
    role: "assistant";
    toolCalls?: readonly LocalLlmCompletedToolCall[];
  }
  | { content: string; role: "tool"; toolCallId: string };

export type LocalLlmAgentToolDefinition = {
  function: {
    description?: string;
    name: string;
    parameters: Record<string, unknown>;
  };
  type: "function";
};

export type LocalLlmAgentStreamEvent =
  | { text: string; type: "assistant_reasoning_delta" }
  | { text: string; type: "assistant_text_delta" }
  | { toolCall: LocalLlmCompletedToolCall; type: "tool_call" };

export type LocalLlmModelToolCallCapability = {
  checkedAt: string;
  /** Never inferred from the model name: true requires explicit runtime metadata. */
  modelSupportsToolCalls: boolean;
  source:
    | "ollama_model_metadata"
    | "lm_studio_model_metadata"
    | "runtime_metadata_does_not_advertise_tools"
    | "runtime_metadata_unavailable";
};

export type LocalLlmToolCapabilityProbe = {
  probe(input: {
    endpoint?: string;
    model: string;
    runtimeId: LocalLlmAgentRuntimeId;
    signal?: AbortSignal;
  }): Promise<LocalLlmModelToolCallCapability>;
};

export type LocalLlmAgentTransport = {
  generate(input: {
    endpoint?: string;
    messages: readonly LocalLlmAgentMessage[];
    model: string;
    onEvent: (event: LocalLlmAgentStreamEvent) => void;
    runtimeId: LocalLlmAgentRuntimeId;
    signal?: AbortSignal;
    tools: readonly LocalLlmAgentToolDefinition[];
  }): Promise<void>;
};

export type LocalLlmChatTransport = {
  generate(input: {
    messages: LocalLlmProviderMessage[];
    model: string;
    onDelta: (text: string) => void;
    onReasoningDelta?: (text: string) => void;
    previousResponseId?: string | null;
    runtimeId: CreateLocalLlmChatInput["runtimeId"];
    signal: AbortSignal;
    systemPrompt?: string;
    useNativeSession?: boolean;
  }): Promise<LocalLlmGenerationResult | void>;
};

export type LocalLlmRuntimeGenerationInput = {
  endpoint?: string;
  messages: readonly LocalLlmAgentMessage[];
  model: string;
  onEvent: (event: LocalLlmAgentStreamEvent) => void;
  previousResponseId?: string | null;
  signal?: AbortSignal;
  tools?: readonly LocalLlmAgentToolDefinition[];
  useNativeSession?: boolean;
};

export type LocalLlmRuntimeAdapter = {
  generate(input: LocalLlmRuntimeGenerationInput): Promise<LocalLlmGenerationResult | void>;
  probeToolCapability(input: {
    endpoint?: string;
    model: string;
    signal?: AbortSignal;
  }): Promise<LocalLlmModelToolCallCapability>;
  runtimeId: LocalLlmAgentRuntimeId;
};

export type LocalLlmRuntimeAdapterRegistry = {
  get(runtimeId: LocalLlmAgentRuntimeId): LocalLlmRuntimeAdapter;
};

export type LocalLlmFetch = typeof fetch;
export type LmStudioEndpointResolver = () => Promise<string>;

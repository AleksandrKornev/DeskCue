import type { AdapterMetadata } from "./types.ts";

export const lmStudioAdapter: AdapterMetadata = {
  id: "lm-studio",
  label: "LM Studio",
  description: "Runs DeskCue-owned local chats through the LM Studio server.",
  supportLevel: "experimental",
  runtimeKind: "llm-runtime",
  capabilities: { attach: false, discover: false, resume: false, start: true }
};

export const ollamaAdapter: AdapterMetadata = {
  id: "ollama",
  label: "Ollama",
  description: "Runs DeskCue-owned local chats through the Ollama API.",
  supportLevel: "experimental",
  runtimeKind: "llm-runtime",
  capabilities: { attach: false, discover: false, resume: false, start: true }
};

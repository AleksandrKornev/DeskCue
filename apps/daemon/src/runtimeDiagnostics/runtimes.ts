import type { RuntimeSummary } from "@deskcue/protocol";

import { inspectClaudeCodeRuntime } from "./claudeCode.ts";
import { inspectCodexRuntime } from "./codex.ts";
import { inspectLmStudioRuntime } from "./lmStudio.ts";
import { inspectOllamaRuntime } from "./ollama.ts";

export async function listRuntimes(): Promise<RuntimeSummary[]> {
  const [ollama, lmStudio, codex, claudeCode] = await Promise.all([
    inspectOllamaRuntime(),
    inspectLmStudioRuntime(),
    inspectCodexRuntime(),
    inspectClaudeCodeRuntime()
  ]);

  return [ollama, lmStudio, codex, claudeCode];
}

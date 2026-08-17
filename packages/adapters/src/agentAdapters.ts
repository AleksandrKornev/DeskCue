import { quoteForShell } from "./shellQuote.ts";
import type { AdapterMetadata, AgentAdapter } from "./types.ts";

export const genericCliAdapter: AgentAdapter & AdapterMetadata = {
  id: "generic-cli",
  label: "Generic CLI",
  description: "Runs any local terminal command inside a workspace.",
  supportLevel: "stable",
  runtimeKind: "generic-cli",
  capabilities: { attach: false, discover: false, resume: false, start: true },
  canHandle: () => true,
  normalize(command, cwd) {
    return { command: command.trim(), cwd };
  }
};

export const codexAdapter: AdapterMetadata & {
  buildResumeCommand(sessionId: string, prompt?: string, executable?: string, model?: string): string;
} = {
  id: "codex",
  label: "Codex",
  description: "Reconnects to an existing Codex session with codex resume.",
  supportLevel: "experimental",
  runtimeKind: "agent-cli",
  capabilities: { attach: true, discover: true, resume: true, start: false },
  buildResumeCommand(sessionId, prompt, executable = "codex", model) {
    const modelFlag = model?.trim() ? ` -m ${quoteForShell(model.trim())}` : "";
    const base = `${quoteForShell(executable)} -c check_for_update_on_startup=false${modelFlag} resume ${quoteForShell(sessionId)}`;
    return prompt?.trim() ? `${base} ${quoteForShell(prompt.trim())}` : base;
  }
};

export const claudeCodeAdapter: AdapterMetadata & {
  buildResumeCommand(sessionId: string): string;
  buildResumePrintCommand(sessionId: string, prompt: string): string;
} = {
  id: "claude-code",
  label: "Claude Code",
  description: "Reconnects to an existing Claude Code session with claude --resume.",
  supportLevel: "experimental",
  runtimeKind: "agent-cli",
  capabilities: { attach: true, discover: true, resume: true, start: false },
  buildResumeCommand: (sessionId) => `claude --resume ${quoteForShell(sessionId)}`,
  buildResumePrintCommand: (sessionId, prompt) =>
    `claude --resume ${quoteForShell(sessionId)} --print ${quoteForShell(prompt.trim())}`
};

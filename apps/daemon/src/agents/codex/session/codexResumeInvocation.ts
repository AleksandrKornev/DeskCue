import { codexAdapter } from "@deskcue/adapters";
import type { CodexSessionRuntimeContext } from "#agents/codex/codexFacade";

function quoteForShell(value: string) {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function renderCodexCommand(executable: string, args: string[]) {
  return [executable, ...args]
    .map(quoteForShell)
    .join(" ");
}

function insertCodexRuntimeFlags(
  command: string,
  runtimeContext: CodexSessionRuntimeContext
) {
  const flags: string[] = [];

  if (runtimeContext.approvalPolicy) {
    flags.push(`-a "${runtimeContext.approvalPolicy}"`);
  }

  if (runtimeContext.sandboxMode) {
    flags.push(`-s "${runtimeContext.sandboxMode}"`);
  }

  if (flags.length === 0) {
    return command;
  }

  const resumeIndex = command.indexOf(" resume ");
  if (resumeIndex < 0) {
    return `${command} ${flags.join(" ")}`.trim();
  }

  return `${command.slice(0, resumeIndex)} ${flags.join(" ")}${command.slice(resumeIndex)}`;
}

export function buildCodexResumeInvocation(input: {
  sessionId: string;
  prompt?: string;
  executable: string;
  model: string | null;
  runtimeContext: CodexSessionRuntimeContext | null;
}) {
  const { sessionId, prompt, executable, model, runtimeContext } = input;
  const normalizedPrompt = prompt?.trim();
  const args = ["-c", "check_for_update_on_startup=false"];

  // `codex resume <id> <prompt>` opens the TUI with the text merely prefilled
  // in the composer.  A DeskCue prompt must instead be a one-shot `exec resume`
  // invocation: it submits the turn immediately and exits after the result.
  if (normalizedPrompt) {
    if (model) {
      args.push("-m", model);
    }
    args.push("exec", "resume", sessionId, normalizedPrompt);

    return {
      command: renderCodexCommand(executable, args),
      args
    };
  }

  if (runtimeContext?.approvalPolicy) {
    args.push("-a", runtimeContext.approvalPolicy);
  }

  if (runtimeContext?.sandboxMode) {
    args.push("-s", runtimeContext.sandboxMode);
  }

  if (model) {
    args.push("-m", model);
  }

  args.push("resume", sessionId);

  const command = codexAdapter.buildResumeCommand(
    sessionId,
    normalizedPrompt,
    executable,
    model ?? undefined
  );

  const renderedCommand =
    runtimeContext?.approvalPolicy || runtimeContext?.sandboxMode
      ? insertCodexRuntimeFlags(command, runtimeContext)
      : command;

  return {
    command: renderedCommand,
    args
  };
}

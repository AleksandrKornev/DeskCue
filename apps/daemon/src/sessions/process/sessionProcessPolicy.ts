import { claudeCodeAdapter, codexAdapter } from "@deskcue/adapters";
import type { SessionDetail, SessionStatus } from "@deskcue/protocol";

type SessionProcessIdentity = Pick<
  SessionDetail,
  "adapterId" | "command" | "sourceSessionId" | "status"
>;

type SessionProcessWriter = {
  write(data: string): void;
};

type SessionProcessAutomation = {
  handleChunk: (chunk: string) => void;
};

type SessionProcessMatcher = {
  adapterId: string;
  commandPattern: RegExp;
};

type SessionInputFormatter = SessionProcessMatcher & {
  format: (input: string, sourceBacked: boolean) => string;
};

type SessionExitStatusResolver = {
  adapterId: string;
  resolve: (
    session: SessionProcessIdentity,
    exitCode: number | null
  ) => SessionStatus | null;
};

type SessionAutomationFactory = SessionProcessMatcher & {
  create: (
    child: SessionProcessWriter,
    onAutomationLog: (text: string) => void
  ) => SessionProcessAutomation;
};

const PTY_SUBMIT_SEQUENCE = process.platform === "win32" ? "\r\n" : "\n";
const CODEX_TUI_SUBMIT_SEQUENCE = process.platform === "win32" ? "\r" : "\n";

function matchesSessionProcess(
  matcher: SessionProcessMatcher,
  adapterId: string,
  command: string
) {
  return matcher.adapterId === adapterId || matcher.commandPattern.test(command);
}

export function formatSessionPtySubmit(input: string) {
  return `${input.replace(/\r?\n$/, "")}${PTY_SUBMIT_SEQUENCE}`;
}

function formatCodexInput(input: string, sourceBacked: boolean) {
  const normalizedInput = input.replace(/\r?\n/g, " ");

  return sourceBacked
    ? `${normalizedInput}\t`
    : `${normalizedInput}${CODEX_TUI_SUBMIT_SEQUENCE}`;
}

function resolveCodexExitStatus(
  session: SessionProcessIdentity,
  exitCode: number | null
): SessionStatus | null {
  // A terminal Codex transcript can finalize the managed shell before the
  // one-shot resume transport has physically exited. DeskCue then terminates
  // that redundant transport; its expected non-zero exit must not overwrite
  // the authoritative resumable state with `failed` and disable the composer.
  if (session.status === "read_only" && session.sourceSessionId) return "read_only";
  if (session.status === "done" && session.sourceSessionId) return "done";

  if (
    exitCode === 0 &&
    session.sourceSessionId &&
    /\bcodex(?:\.exe)?\b/i.test(session.command) &&
    /\sexec\s+resume\b/i.test(session.command)
  ) {
    return "done";
  }

  return null;
}

function resolveClaudeExitStatus(
  session: SessionProcessIdentity,
  exitCode: number | null
): SessionStatus | null {
  if (
    exitCode === 0 &&
    session.sourceSessionId &&
    /\bclaude(?:\.exe)?\b/i.test(session.command) &&
    /\s--print\b/i.test(session.command)
  ) {
    return "read_only";
  }

  return null;
}

function stripAnsi(value: string) {
  return value
    .replace(/\u001b\][^\u0007]*\u0007/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function createCodexAutomation(
  child: SessionProcessWriter,
  onAutomationLog: (text: string) => void
): SessionProcessAutomation {
  let buffer = "";
  let handledUpdatePrompt = false;
  let handledModelNux = false;

  return {
    handleChunk(chunk) {
      buffer = `${buffer}${stripAnsi(chunk)}`.slice(-12000);

      if (
        !handledUpdatePrompt &&
        buffer.includes("Update available!") &&
        buffer.includes("Press enter to continue")
      ) {
        handledUpdatePrompt = true;
        child.write("\u001b[B\u001b[B\r");
        onAutomationLog("DeskCue auto-dismissed the Codex update prompt.\n");
        return;
      }

      if (
        !handledModelNux &&
        buffer.includes("Choose how you'd like Codex to proceed.") &&
        buffer.includes("Use ↑/↓ to move, press enter to confirm")
      ) {
        handledModelNux = true;
        child.write("\u001b[B\r");
        onAutomationLog("DeskCue auto-selected the existing Codex model.\n");
      }
    }
  };
}

const codexProcessMatcher: SessionProcessMatcher = {
  adapterId: codexAdapter.id,
  commandPattern: /\bcodex(?:\.exe)?\b/i
};

const claudeProcessMatcher: SessionProcessMatcher = {
  adapterId: claudeCodeAdapter.id,
  commandPattern: /\bclaude(?:\.exe)?\b/i
};

const sessionInputFormatters: SessionInputFormatter[] = [
  {
    ...codexProcessMatcher,
    format: formatCodexInput
  }
];

const sessionExitStatusResolvers: SessionExitStatusResolver[] = [
  {
    adapterId: codexAdapter.id,
    resolve: resolveCodexExitStatus
  },
  {
    adapterId: claudeCodeAdapter.id,
    resolve: resolveClaudeExitStatus
  }
];

const interactiveSessionProcessMatchers: SessionProcessMatcher[] = [
  codexProcessMatcher,
  claudeProcessMatcher
];

const sessionAutomationFactories: SessionAutomationFactory[] = [
  {
    ...codexProcessMatcher,
    create: createCodexAutomation
  }
];

export function createSessionProcessAutomation(input: {
  adapterId: string;
  child: SessionProcessWriter;
  command: string;
  onAutomationLog: (text: string) => void;
}) {
  const factory = sessionAutomationFactories.find((candidate) =>
    matchesSessionProcess(candidate, input.adapterId, input.command)
  );

  return factory?.create(input.child, input.onAutomationLog) ?? null;
}

export function formatSessionProcessInput(
  session: Pick<SessionDetail, "adapterId" | "command" | "sourceSessionId">,
  input: string
) {
  const formatter = sessionInputFormatters.find((candidate) =>
    matchesSessionProcess(candidate, session.adapterId, session.command)
  );

  if (formatter) return formatter.format(input, Boolean(session.sourceSessionId));

  const normalizedInput = session.sourceSessionId ? input.replace(/\r?\n/g, " ") : input;

  return formatSessionPtySubmit(normalizedInput);
}

export function getSessionProcessExitStatusOverride(
  session: SessionProcessIdentity,
  exitCode: number | null
) {
  const resolver = sessionExitStatusResolvers.find(
    (candidate) => candidate.adapterId === session.adapterId
  );

  return resolver?.resolve(session, exitCode) ?? null;
}

export function isInteractiveSessionProcess(adapterId: string, command: string) {
  return interactiveSessionProcessMatchers.some((matcher) =>
    matchesSessionProcess(matcher, adapterId, command)
  );
}

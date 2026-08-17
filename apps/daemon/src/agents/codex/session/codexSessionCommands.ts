import { codexAdapter } from "@deskcue/adapters";
import type { SessionDetail } from "@deskcue/protocol";
import { AppError } from "#application/errors";
import type { RunningChild } from "#sessions/process/sessionProcess";

import { sendCodexPrompt } from "./codexPromptDelivery.ts";

type CodexRestartOptions = {
  prompt?: string;
  reason: "prompt" | "interrupt";
};

export type CodexSessionCommandCallbacks = {
  getChild: (sessionId: string) => RunningChild | undefined;
  getSession: (sessionId: string) => SessionDetail | null;
  restartCodexTransport: (
    session: SessionDetail,
    options: CodexRestartOptions
  ) => Promise<SessionDetail>;
};

export async function sendInputToCodexSession(
  callbacks: Pick<CodexSessionCommandCallbacks, "restartCodexTransport">,
  session: SessionDetail,
  child: RunningChild | undefined,
  input: string
): Promise<SessionDetail> {
  return sendCodexPrompt({
    child,
    restart: (options) => callbacks.restartCodexTransport(session, options),
    prompt: input,
    session
  });
}

export async function interruptCodexSession(
  callbacks: CodexSessionCommandCallbacks,
  sessionId: string
): Promise<SessionDetail> {
  const session = callbacks.getSession(sessionId);
  const child = callbacks.getChild(sessionId);
  if (!session) {
    throw new AppError("not_found", "Session not found.");
  }

  if (!child) {
    if (
      session.adapterId === codexAdapter.id &&
      session.sourceSessionId &&
      (session.status === "read_only" ||
        session.status === "running" ||
        session.status === "stopped")
    ) {
      throw new AppError(
        "not_accepting_input",
        "This external Codex chat is not controlled by DeskCue. Use Force stop only when DeskCue verifies its process identity."
      );
    }

    if (session.status === "stopped" || session.status === "failed" || session.status === "done") {
      return session;
    }

    throw new AppError("not_accepting_input", "Session is not running.");
  }

  if (session.adapterId === codexAdapter.id && session.sourceSessionId) {
    return callbacks.restartCodexTransport(session, {
      reason: "interrupt"
    });
  }

  throw new AppError(
    "not_accepting_input",
    "Prompt interrupt is only available for taken-over Codex chats."
  );
}

export type SessionInterruptLifecycle = {
  phase: "idle" | "requested" | "confirmed" | "unresolved";
  requestedAt: string | null;
  confirmedAt: string | null;
  turnFingerprint: string | null;
  confirmation: "source_terminal" | "managed_transport" | "verified_process" | null;
};

const idleInterruptLifecycle: SessionInterruptLifecycle = {
  phase: "idle",
  requestedAt: null,
  confirmedAt: null,
  turnFingerprint: null,
  confirmation: null
};

export function getSessionInterruptLifecycle(
  session: object | null | undefined
) {
  return (session as ({
    interruptLifecycle?: SessionInterruptLifecycle;
  }) | null | undefined)?.interruptLifecycle ?? idleInterruptLifecycle;
}

export function isInterruptLifecycleUnconfirmed(
  lifecycle: SessionInterruptLifecycle
) {
  return lifecycle.phase === "unresolved" ||
    (lifecycle.phase === "confirmed" && lifecycle.confirmation === "managed_transport");
}

export function isInterruptLifecycleWaitingSuppressed(
  lifecycle: SessionInterruptLifecycle,
  currentPromptRequestedAt?: string | null
) {
  const lifecycleRequestedAt = Date.parse(lifecycle.requestedAt ?? "");
  const promptRequestedAt = Date.parse(currentPromptRequestedAt ?? "");

  if (
    Number.isFinite(lifecycleRequestedAt) &&
    Number.isFinite(promptRequestedAt) &&
    promptRequestedAt > lifecycleRequestedAt
  ) {
    return false;
  }

  return lifecycle.phase === "requested" || lifecycle.phase === "confirmed" ||
    lifecycle.confirmation === "verified_process" ||
    isInterruptLifecycleUnconfirmed(lifecycle);
}

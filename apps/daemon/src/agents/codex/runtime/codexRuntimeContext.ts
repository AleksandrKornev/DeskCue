import type { CodexApprovalPolicy, CodexSandboxMode } from "@deskcue/protocol";

export interface CodexSessionRuntimeContext {
  approvalPolicy: CodexApprovalPolicy | null;
  model: string | null;
  sandboxMode: CodexSandboxMode | null;
}

function toNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toApprovalPolicy(value: unknown): CodexApprovalPolicy | null {
  return value === "untrusted" ||
    value === "on-failure" ||
    value === "on-request" ||
    value === "never"
    ? value
    : null;
}

function toSandboxMode(value: unknown): CodexSandboxMode | null {
  return value === "read-only" ||
    value === "workspace-write" ||
    value === "danger-full-access"
    ? value
    : null;
}

function safeParseJson<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

export function extractCodexRuntimeContextLine(line: string): CodexSessionRuntimeContext | null {
  const item = safeParseJson<Record<string, unknown>>(line.trim());
  if (!item || item.type !== "turn_context") {
    return null;
  }

  const payload = isRecord(item.payload) ? item.payload : null;
  if (!payload) {
    return null;
  }

  const sandboxPolicy = isRecord(payload.sandbox_policy) ? payload.sandbox_policy : null;
  const approvalPolicy = toApprovalPolicy(payload.approval_policy);
  const model = toNonEmptyString(payload.model);
  const sandboxMode = toSandboxMode(sandboxPolicy?.type);

  if (!approvalPolicy && !model && !sandboxMode) {
    return null;
  }

  return {
    approvalPolicy,
    model,
    sandboxMode
  };
}

export function extractCodexRuntimeContext(raw: string): CodexSessionRuntimeContext | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const context = extractCodexRuntimeContextLine(lines[index]);
    if (context) {
      return context;
    }
  }

  return null;
}

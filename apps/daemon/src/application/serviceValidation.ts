import type { CreateSessionInput } from "@deskcue/protocol";

import { AppError } from "./errors.ts";

export function requireNonEmptyString(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError("invalid_input", `Field ${fieldName} must be a non-empty string.`);
  }

  return normalized;
}

export function validateCreateSessionInput(input: CreateSessionInput): CreateSessionInput {
  return {
    command: requireNonEmptyString(input.command, "command"),
    workspaceId: requireNonEmptyString(input.workspaceId, "workspaceId")
  };
}

export function validatePreviewPort(port: number | null): number | null {
  if (
    port !== null &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    throw new AppError(
      "invalid_input",
      "Field port must be an integer between 1 and 65535, or null."
    );
  }

  return port;
}

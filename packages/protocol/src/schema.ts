export class ProtocolSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolSchemaError";
  }
}

export function readProtocolObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolSchemaError("Request body must be an object.");
  }

  return value as Record<string, unknown>;
}

export function readRequiredProtocolString(
  body: Record<string, unknown>,
  fieldName: string
) {
  const value = body[fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProtocolSchemaError(`Field ${fieldName} must be a non-empty string.`);
  }

  return value;
}

export function readOptionalProtocolString(
  body: Record<string, unknown>,
  fieldName: string
) {
  const value = body[fieldName];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ProtocolSchemaError(`Field ${fieldName} must be a string when provided.`);
  }

  return value;
}

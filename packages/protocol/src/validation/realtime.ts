import { ProtocolSchemaError } from "../schema.ts";

export function requireStrings(body: Record<string, unknown>, ...fields: string[]) {
  for (const field of fields) {
    if (typeof body[field] !== "string" || (body[field] as string).trim() === "") {
      throw new ProtocolSchemaError(`Server event field ${field} must be a non-empty string.`);
    }
  }
}

export function requireBoolean(body: Record<string, unknown>, field: string) {
  if (typeof body[field] !== "boolean") {
    throw new ProtocolSchemaError(`Server event field ${field} must be a boolean.`);
  }
}

export function requireOptionalBoolean(body: Record<string, unknown>, field: string) {
  if (body[field] !== undefined && typeof body[field] !== "boolean") {
    throw new ProtocolSchemaError(`Server event field ${field} must be a boolean when provided.`);
  }
}

export function requireNullableStrings(body: Record<string, unknown>, ...fields: string[]) {
  for (const field of fields) {
    if (body[field] !== null && typeof body[field] !== "string") {
      throw new ProtocolSchemaError(`Server event field ${field} must be a string or null.`);
    }
  }
}

export function requireOptionalNullableStrings(
  body: Record<string, unknown>,
  ...fields: string[]
) {
  for (const field of fields) {
    if (
      body[field] !== undefined &&
      body[field] !== null &&
      typeof body[field] !== "string"
    ) {
      throw new ProtocolSchemaError(`Server event field ${field} must be a string or null when provided.`);
    }
  }
}

export function requireOneOf(
  body: Record<string, unknown>,
  field: string,
  values: readonly string[]
) {
  if (typeof body[field] !== "string" || !values.includes(body[field])) {
    throw new ProtocolSchemaError(`Server event field ${field} is invalid.`);
  }
}

export function requireNullableOneOf(
  body: Record<string, unknown>,
  field: string,
  values: readonly string[]
) {
  if (body[field] !== null && (
    typeof body[field] !== "string" || !values.includes(body[field])
  )) {
    throw new ProtocolSchemaError(`Server event field ${field} is invalid.`);
  }
}

export function requireOptionalNullableOneOf(
  body: Record<string, unknown>,
  field: string,
  values: readonly string[]
) {
  if (body[field] !== undefined && body[field] !== null && (
    typeof body[field] !== "string" || !values.includes(body[field])
  )) {
    throw new ProtocolSchemaError(`Server event field ${field} is invalid.`);
  }
}

export function requireStringArray(body: Record<string, unknown>, field: string) {
  if (!Array.isArray(body[field]) || !body[field].every((value) => typeof value === "string")) {
    throw new ProtocolSchemaError(`Server event field ${field} must be an array of strings.`);
  }
}

export function requireNonNegativeNumber(body: Record<string, unknown>, field: string) {
  if (typeof body[field] !== "number" || !Number.isSafeInteger(body[field]) || body[field] < 0) {
    throw new ProtocolSchemaError(`Server event field ${field} must be a non-negative integer.`);
  }
}

export function requireOptionalNonNegativeNumber(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new ProtocolSchemaError(
      `Server event field ${field} must be a non-negative integer when provided.`
    );
  }
}

export function requireOptionalNullableNonNegativeNumber(
  body: Record<string, unknown>,
  field: string
) {
  const value = body[field];
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new ProtocolSchemaError(
      `Server event field ${field} must be a non-negative integer or null when provided.`
    );
  }
}

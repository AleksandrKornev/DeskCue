export function readPositiveIntegerQuery(value: unknown) {
  const rawValue: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return null;
  }

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

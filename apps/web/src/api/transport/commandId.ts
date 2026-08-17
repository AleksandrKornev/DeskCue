const COMMAND_ID_FALLBACK_BYTES = 16;

export function createDeskCueCommandId() {
  if (typeof crypto.randomUUID === "function") {
    return `deskcue-${crypto.randomUUID()}`;
  }

  const bytes = crypto.getRandomValues(new Uint8Array(COMMAND_ID_FALLBACK_BYTES));
  return `deskcue-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

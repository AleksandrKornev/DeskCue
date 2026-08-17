import { AppError } from "#application/errors";

import type { ImportedLocalLlmChatMessage } from "../../storage/localLlmChatLibrary.ts";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 200_000;

function limitText(value: string) {
  return value.trim().slice(0, MAX_MESSAGE_CHARS);
}

function readObject(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readSelectedVersion(value: unknown): (Record<string, unknown> & { role: "user" | "assistant" }) | null {
  const entry = readObject(value);
  const versions = Array.isArray(entry.versions) ? entry.versions : [];
  const index = typeof entry.currentlySelected === "number" ? entry.currentlySelected : -1;
  const selected = index >= 0 && index < versions.length ? readObject(versions[index]) : null;
  return selected && (selected.role === "user" || selected.role === "assistant")
    ? { ...selected, role: selected.role }
    : null;
}

function readAssistantText(version: Record<string, unknown>) {
  const steps = Array.isArray(version.steps) ? version.steps : [];
  return steps.flatMap((step) => {
    const record = readObject(step);
    if (record.type !== "contentBlock" || record.shouldIncludeInContext === false) return [];
    return Array.isArray(record.content) ? record.content as unknown[] : [];
  }).map(readObject).filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string).join("").trim().slice(0, MAX_MESSAGE_CHARS);
}

function joinText(parts: unknown[]) {
  return parts.map(readObject).filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string).join("\n").trim().slice(0, MAX_MESSAGE_CHARS);
}

function readUserText(version: Record<string, unknown>) {
  return joinText(Array.isArray(version.content) ? version.content : []);
}

export function parseLmStudioDesktopConversation(content: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_BYTES) {
    throw new AppError("invalid_input", "LM Studio export exceeds the 8 MiB import limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new AppError("invalid_input", "Choose a valid LM Studio .conversation.json export.");
  }
  const root = readObject(value);
  const messages = Array.isArray(root.messages) ? root.messages : [];
  const imported: ImportedLocalLlmChatMessage[] = [];
  for (const entry of messages) {
    const selected = readSelectedVersion(entry);
    if (!selected) continue;
    const role = selected.role;
    const text = role === "user" ? readUserText(selected) : role === "assistant" ? readAssistantText(selected) : "";
    if (text) imported.push({ role, text });
  }
  if (!imported.length) {
    throw new AppError("invalid_input", "This export has no importable user or assistant text.");
  }
  return {
    messages: imported,
    systemPrompt: typeof root.systemPrompt === "string" ? limitText(root.systemPrompt) : undefined
  };
}

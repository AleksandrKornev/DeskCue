import type { ConversationActivity } from "@modules/session/types";

export function buildWaitingDetailStickKey(
  entry: ConversationActivity["entries"][number] | null
) {
  if (!entry) {
    return "";
  }

  const partsKey =
    entry.parts
      ?.map((part) => {
        if (part.type === "markdown") {
          return `${part.type}:${part.text.length}`;
        }

        if (part.type === "status") {
          return `${part.type}:${part.label.length}:${part.detail?.length ?? 0}`;
        }

        if (part.type === "tool_result") {
          return `${part.type}:${part.text.length}`;
        }

        if (part.type === "diff") {
          return `${part.type}:${part.filePath?.length ?? 0}:${part.text.length}`;
        }

        return part.type;
      })
      .join("|") ?? "";

  return `${entry.id}:${entry.timestamp}:${entry.text.length}:${partsKey}`;
}

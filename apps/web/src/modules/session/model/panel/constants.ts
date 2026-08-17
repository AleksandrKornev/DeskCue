import type { ConversationActivity } from "@modules/session/types";

export const CHAT_ACTIVITY_ENTRY_RENDER_LIMIT: Record<
  ConversationActivity["kind"],
  number | undefined
> = {
  changes: undefined,
  context: 4,
  details: 200,
  model: 4,
  tools: 200
};

// Source transcript snapshots can briefly report an active turn while the next
// hydration catches up. Do not let that transient state flash a whole waiting
// panel into an otherwise stable chat.
export const EXTERNAL_WAIT_VISIBILITY_DELAY_MS = 500;

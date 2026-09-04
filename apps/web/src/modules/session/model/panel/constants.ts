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

// Adjacent source snapshots can briefly disagree while transcript hydration
// catches up. Hold the visible external turn across a short inactive edge so
// the waiting panel and composer do not disappear between two snapshots.
export const EXTERNAL_WAIT_INACTIVE_CONFIRMATION_DELAY_MS = 1_000;

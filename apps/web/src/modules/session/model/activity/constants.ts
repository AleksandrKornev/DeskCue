import type { ConversationActivity } from "@modules/session/types";

export const MAX_HYDRATION_ENTRY_IDS_BY_KIND: Record<
  ConversationActivity["kind"],
  number | null
> = {
  changes: null,
  context: 4,
  details: 200,
  model: 4,
  tools: 200
};

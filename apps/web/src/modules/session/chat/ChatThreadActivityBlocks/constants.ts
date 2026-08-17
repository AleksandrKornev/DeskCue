import styles from "@modules/session/chat/styles.module.scss";
import type { ConversationActivity } from "@modules/session/types";

export const inlineActivityToggleClassByKind: Partial<
  Record<ConversationActivity["kind"], string>
> = {
  changes: styles.chatInlineActivityToggleChanges,
  context: styles.chatInlineActivityToggleContext,
  model: styles.chatInlineActivityToggleModel,
  tools: styles.chatInlineActivityToggleTools
};

export const inlineActivityBadgeClassByKind: Record<
  ConversationActivity["kind"],
  string
> = {
  changes: styles.chatInlineActivityBadgeChanges,
  context: styles.chatInlineActivityBadgeContext,
  details: styles.chatInlineActivityBadgeDetails,
  model: styles.chatInlineActivityBadgeModel,
  tools: styles.chatInlineActivityBadgeTools
};

export const messageActivityChipClassByKind: Record<
  ConversationActivity["kind"],
  string
> = {
  changes: styles.chatMessageActivityChipChanges,
  context: styles.chatMessageActivityChipContext,
  details: styles.chatMessageActivityChipDetails,
  model: styles.chatMessageActivityChipModel,
  tools: styles.chatMessageActivityChipTools
};

import type { ManagedSessionChatThreadProps } from "@modules/session/chat/types";
import type { ConversationActivity } from "@modules/session/types";

export type RenderActivityEntries = ManagedSessionChatThreadProps["renderActivityEntries"];

export type ChatInlineActivityFeedProps = {
  activities: ConversationActivity[];
  isActivityExpanded: ManagedSessionChatThreadProps["isActivityExpanded"];
  onHydrateActivity: ManagedSessionChatThreadProps["onHydrateActivityGroup"];
  renderActivityEntries: RenderActivityEntries;
};

export type ChatInlineActivityItemProps = {
  activity: ConversationActivity;
  isExpanded: boolean;
  onHydrate: (activity: ConversationActivity) => void;
  onToggle: () => void;
  renderActivityEntries: RenderActivityEntries;
  scrollExpandedContent?: boolean;
};

export type ChatMessageActivityChipProps = {
  activity: ConversationActivity;
  isExpanded: boolean;
  onToggle: () => void;
};

export type ChatLifecycleActivityProps = {
  activity: ConversationActivity;
};

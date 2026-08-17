import type { ChatTranscriptEntry } from "@modules/session/types";

import styles from "./styles.module.scss";

export const activityEntryClassByRole: Partial<
  Record<ChatTranscriptEntry["role"], string>
> = {
  commentary: styles.activityEntryCommentary,
  system: styles.activityEntrySystem,
  tool: styles.activityEntryTool
};

export const messageClassByRole = {
  assistant: styles.chatMessageAssistant,
  user: styles.chatMessageUser
} as const;

export const messageFooterClassByRole = {
  assistant: styles.chatMessageFooterAssistant,
  user: styles.chatMessageFooterUser
} as const;

export const turnStatusClassByKind: Partial<Record<string, string>> = {
  failed: styles.chatMessageTurnStatusFailed,
  incomplete: styles.chatMessageTurnStatusIncomplete,
  interrupted: styles.chatMessageTurnStatusSuperseded,
  superseded: styles.chatMessageTurnStatusSuperseded
};

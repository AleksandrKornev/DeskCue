import type { ChatTranscriptEntry } from "@modules/session/types";

import styles from "./styles.module.scss";
export const activityEntryClassByRole: Partial<
  Record<ChatTranscriptEntry["role"], string>
> = {
  commentary: styles.activityEntryCommentary,
  system: styles.activityEntrySystem,
  tool: styles.activityEntryTool
};

export const PROGRESSIVE_RENDER_THRESHOLD = 3;

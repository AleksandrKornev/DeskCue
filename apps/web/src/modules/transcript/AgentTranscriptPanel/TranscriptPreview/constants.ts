import type { TranscriptEntry } from "@modules/transcript/AgentTranscriptPanel/types";

import styles from "./styles.module.scss";

export const transcriptEntryClassByRole: Partial<
  Record<TranscriptEntry["role"], string>
> = {
  assistant: styles.entryAssistant,
  user: styles.entryUser
};

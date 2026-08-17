export const DEFAULT_AGENT_SESSION_CHAT_MESSAGE_TAIL = 24;
export const MAX_AGENT_SESSION_CHAT_MESSAGE_TAIL = 200;
export const DEFAULT_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT = 4;
export const MAX_TRANSCRIPT_DELTA_OVERLAP_ITEM_COUNT = 12;

export { transcriptHttpCache } from "../hydration/projectionCache.ts";
export { buildTranscriptViewDelta } from "./deltaProjection.ts";
export {
  buildTranscriptViewDeltaEtag,
  buildTranscriptViewDeltaSourceVersionEtag,
  buildTranscriptViewEtag,
  buildTranscriptViewSourceVersionEtag
} from "./etags.ts";
export type { TranscriptViewEtagOptions } from "./etags.ts";
export {
  readAgentSessionDetailReadMode,
  toAgentSessionSummary
} from "./sessionProjection.ts";
export {
  enrichTranscriptViewSourceVersionSummary,
  tryBuildLightweightTranscriptUpdates,
  tryBuildTranscriptUpdatesFromSourceTailWindow,
  tryBuildTranscriptViewFromSourceTailWindow
} from "./windowProjection.ts";

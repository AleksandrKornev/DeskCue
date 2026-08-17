export const MAX_LOCAL_LLM_ASSISTANT_MESSAGE_BYTES = 512 * 1024;
export const MAX_LOCAL_LLM_HISTORY_PAGE_BYTES = 512 * 1024;
// JSON escaping can expand a one-byte control character to a six-byte
// `\uXXXX` sequence. Keep the bounded record envelope large enough for every
// valid max-size message plus its fixed metadata, not merely its text payload.
export const MAX_LOCAL_LLM_JSONL_RECORD_BYTES = 4 * 1024 * 1024;
export const MAX_LOCAL_LLM_CHANGESET_DIFF_BYTES = 4 * 1024 * 1024;
export const MAX_LOCAL_LLM_CHANGESET_SIDECAR_BYTES = 8 * 1024 * 1024;

import type { PreviewTicketState } from "./types";

export function createEmptyPreviewTicketState(): PreviewTicketState {
  return {
    documentRevision: 0,
    error: "",
    key: "",
    loading: false,
    resolvedCredentialRevision: "",
    resolvedKey: "",
    url: null
  };
}

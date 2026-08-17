import type { IssuePreviewTicketInput } from "@deskcue/protocol";
import {
  parsePreviewCandidatesResponse,
  parsePreviewTicketResponse
} from "@deskcue/protocol";
import { getJson, postJson } from "@api/transport/requests";

export const previewApi = {
  async discoverCandidates(input: IssuePreviewTicketInput, signal?: AbortSignal) {
    const query = new URLSearchParams({
      kind: input.kind,
      ownerId: input.ownerId
    });
    return parsePreviewCandidatesResponse(await getJson<unknown>(
      `/api/preview/candidates?${query.toString()}`,
      "Failed to find local preview apps",
      { signal }
    ));
  },

  async issueTicket(input: IssuePreviewTicketInput, signal?: AbortSignal) {
    return parsePreviewTicketResponse(await postJson<unknown>(
      "/api/preview/tickets",
      input,
      "Failed to open the local preview",
      { signal }
    ));
  }
};

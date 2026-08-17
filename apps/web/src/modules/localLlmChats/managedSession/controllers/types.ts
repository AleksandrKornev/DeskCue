import type { LocalLlmChatDetail, RuntimeSummary } from "@deskcue/protocol";

export type DetailRefreshState = {
  chatId: string;
  inFlight: boolean;
  mutationInFlight: boolean;
  mutationRevision: number;
};

export type DetailMutationToken = {
  revision: number;
  state: DetailRefreshState;
};

export type UseLmStudioChatControllerOptions = {
  chatId: string;
  detail: LocalLlmChatDetail | null;
  runtime: RuntimeSummary | null;
  mutateDetail: (
    mutation: () => Promise<LocalLlmChatDetail>
  ) => Promise<LocalLlmChatDetail>;
  setError: (error: string | null) => void;
};

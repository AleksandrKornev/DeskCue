type ComposerSubmissionState = {
  canSubmitDraft: boolean;
  isActionDecisionPending: boolean;
  shouldSubmitReplacement: boolean;
};

type ComposerSubmissionLifecycle = {
  generation: number;
  scopeKey: string;
  state: ComposerSubmissionState;
};

export function syncComposerSubmissionLifecycle(
  lifecycle: ComposerSubmissionLifecycle | null,
  scopeKey: string,
  state: ComposerSubmissionState
) {
  if (!lifecycle) return { generation: 0, scopeKey, state };

  if (lifecycle.scopeKey !== scopeKey) {
    lifecycle.generation += 1;
    lifecycle.scopeKey = scopeKey;
  }

  lifecycle.state = state;
  return lifecycle;
}

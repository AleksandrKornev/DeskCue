const MAX_CACHED_COMPOSER_DRAFTS = 32;

type ComposerDraftRecord = {
  revision: number;
  value: string;
};

type ComposerDraftListener = (draft: string) => void;

const composerDrafts = new Map<string, ComposerDraftRecord>();
const composerDraftListeners = new Map<string, Set<ComposerDraftListener>>();
let nextComposerDraftRevision = 1;

export function readComposerDraft(scopeKey: string) {
  return composerDrafts.get(scopeKey)?.value ?? "";
}

function notifyComposerDraftListeners(scopeKey: string) {
  const draft = readComposerDraft(scopeKey);

  for (const listener of composerDraftListeners.get(scopeKey) ?? []) listener(draft);
}

export function clearComposerDraft(scopeKey: string, expectedRevision?: number) {
  const currentDraft = composerDrafts.get(scopeKey);

  if (expectedRevision !== undefined && currentDraft?.revision !== expectedRevision) return false;

  const cleared = composerDrafts.delete(scopeKey);

  if (cleared) notifyComposerDraftListeners(scopeKey);

  return cleared;
}

export function isComposerDraftRevisionCurrent(scopeKey: string, revision: number) {
  return composerDrafts.get(scopeKey)?.revision === revision;
}

export function rememberComposerDraft(scopeKey: string, draft: string) {
  const record = { revision: nextComposerDraftRevision, value: draft };

  nextComposerDraftRevision += 1;

  composerDrafts.delete(scopeKey);
  composerDrafts.set(scopeKey, record);
  notifyComposerDraftListeners(scopeKey);

  if (composerDrafts.size <= MAX_CACHED_COMPOSER_DRAFTS) return record.revision;

  const oldestScopeKey = composerDrafts.keys().next().value;

  if (oldestScopeKey !== undefined) {
    composerDrafts.delete(oldestScopeKey);
    notifyComposerDraftListeners(oldestScopeKey);
  }

  return record.revision;
}

export function subscribeComposerDraft(scopeKey: string, listener: ComposerDraftListener) {
  const listeners = composerDraftListeners.get(scopeKey) ?? new Set<ComposerDraftListener>();

  listeners.add(listener);
  composerDraftListeners.set(scopeKey, listeners);

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) composerDraftListeners.delete(scopeKey);
  };
}

import type { SessionDetail } from "@deskcue/protocol";
import { launchManagedSession } from "#sessions/lifecycle/sessionLaunch";

import { createSessionLaunchCallbacks } from "../../callbacks/storeBackedSessionCallbacks.ts";
import type {
  StoreBackedSessionCallbackContext,
  StoreBackedSessionLaunchInput
} from "../../callbacks/storeBackedSessionCallbacks.ts";
import type { PromptDeliveryJournal } from "../storeBackedPromptTransportCoordinator.ts";

export function launchStoreBackedManagedSession(
  callbackContext: StoreBackedSessionCallbackContext,
  promptDeliveries: PromptDeliveryJournal,
  input: StoreBackedSessionLaunchInput
): Promise<SessionDetail> {
  const callbacks = createSessionLaunchCallbacks(callbackContext);
  return launchManagedSession({
    ...callbacks,
    markPromptAccepted: (deliveryId) => {
      const accepted = promptDeliveries.markAccepted(deliveryId);
      if (!accepted) promptDeliveries.markOutcomeUnknown(deliveryId);
      return accepted;
    },
    markPromptDispatching: (deliveryId) =>
      promptDeliveries.markDispatching(deliveryId),
    markPromptNotSentAfterSpawnFailure: (deliveryId) =>
      promptDeliveries.markNotSentAfterSynchronousSpawnFailure?.(deliveryId) ??
      promptDeliveries.markNotSent(deliveryId),
    markPromptOutcomeUnknown: (deliveryId) =>
      promptDeliveries.markOutcomeUnknown(deliveryId),
    preparePromptDelivery: (session, prompt, requestedAt) =>
      promptDeliveries.prepare(session, prompt, requestedAt)
  }, input);
}

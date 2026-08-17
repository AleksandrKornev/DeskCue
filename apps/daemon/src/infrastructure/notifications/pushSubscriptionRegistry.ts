import { randomUUID } from "node:crypto";

import type { PushSubscriptionListResponse } from "@deskcue/protocol";

import {
  formatPushSubscriptionLabel,
  isCurrentPushSubscription,
  retainNewestPushSubscriptions
} from "./state/notificationState.ts";
import type {
  ListPushSubscriptionsInput,
  PushSubscriptionInput,
  RemovePushSubscriptionInput,
  StoredPushState,
  StoredPushSubscription
} from "./state/notificationTypes.ts";

type PushSubscriptionRegistryOptions = {
  getState: () => StoredPushState;
  persistState: () => Promise<void>;
  setState: (state: StoredPushState) => void;
  maxSubscriptions: number;
};

export function createPushSubscriptionRegistry({
  getState,
  maxSubscriptions,
  persistState,
  setState
}: PushSubscriptionRegistryOptions) {
  function listSubscriptions({
    accessDeviceId = null,
    pushClientId = null
  }: ListPushSubscriptionsInput = {}): PushSubscriptionListResponse {
    const state = getState();
    return {
      subscriptionCount: state.subscriptions.length,
      subscriptions: state.subscriptions
        .map((subscription) => ({
          createdAt: subscription.createdAt,
          current: isCurrentPushSubscription(subscription, accessDeviceId, pushClientId),
          id: subscription.id,
          label: formatPushSubscriptionLabel(subscription.userAgent),
          lastDeliveredAt: subscription.lastDeliveredAt ?? null,
          updatedAt: subscription.updatedAt
        }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    };
  }

  async function registerSubscription({
    accessDeviceId = null,
    pushClientId = null,
    replaceEndpoint = null,
    subscription,
    userAgent = null
  }: PushSubscriptionInput) {
    const state = getState();
    const endpoint = subscription.endpoint;
    const now = new Date().toISOString();
    const shouldReplaceLegacyUserAgentRecords = Boolean(
      replaceEndpoint &&
      (accessDeviceId || pushClientId) &&
      userAgent
    );
    if (replaceEndpoint || accessDeviceId || pushClientId) {
      setState({
        ...state,
        subscriptions: state.subscriptions.filter(
          (item) =>
            item.subscription.endpoint === endpoint ||
            (
              (!replaceEndpoint || item.subscription.endpoint !== replaceEndpoint) &&
              (!accessDeviceId || item.accessDeviceId !== accessDeviceId) &&
              (!pushClientId || item.pushClientId !== pushClientId) &&
              (
                !shouldReplaceLegacyUserAgentRecords ||
                item.accessDeviceId ||
                item.pushClientId ||
                item.userAgent !== userAgent
              )
            )
        )
      });
    }

    const currentState = getState();
    const existing = currentState.subscriptions.find(
      (item) => item.subscription.endpoint === endpoint
    );
    if (existing) {
      existing.subscription = subscription;
      existing.accessDeviceId = accessDeviceId;
      existing.pushClientId = pushClientId;
      existing.updatedAt = now;
      existing.userAgent = userAgent;
      await persistState();
      return existing;
    }

    const nextSubscription: StoredPushSubscription = {
      accessDeviceId,
      createdAt: now,
      id: randomUUID(),
      lastDeliveredAt: null,
      pushClientId,
      subscription,
      updatedAt: now,
      userAgent
    };
    setState({
      ...currentState,
      subscriptions: retainNewestPushSubscriptions(
        [...currentState.subscriptions, nextSubscription],
        maxSubscriptions
      )
    });
    await persistState();
    return nextSubscription;
  }

  async function removeSubscription({
    accessDeviceId = null,
    endpoint = null,
    pushClientId = null
  }: RemovePushSubscriptionInput) {
    const state = getState();
    const beforeCount = state.subscriptions.length;
    const subscriptions = state.subscriptions.filter(
      (item) =>
        (!endpoint || item.subscription.endpoint !== endpoint) &&
        (!accessDeviceId || item.accessDeviceId !== accessDeviceId) &&
        (!pushClientId || item.pushClientId !== pushClientId)
    );
    const removedCount = beforeCount - subscriptions.length;
    setState({ ...state, subscriptions });
    if (removedCount > 0) {
      await persistState();
    }

    return {
      removedCount,
      subscriptionCount: subscriptions.length
    };
  }

  async function removeSubscriptionById(subscriptionId: string) {
    const state = getState();
    const subscription = state.subscriptions.find((item) => item.id === subscriptionId);
    if (!subscription) {
      return null;
    }

    const subscriptions = state.subscriptions.filter((item) => item.id !== subscriptionId);
    setState({ ...state, subscriptions });
    await persistState();
    return {
      removedCount: 1,
      subscriptionCount: subscriptions.length
    };
  }

  return {
    listSubscriptions,
    registerSubscription,
    removeSubscription,
    removeSubscriptionById
  };
}

import type {
  RegisterPushSubscriptionInput,
  RemovePushSubscriptionInput,
  PushSubscriptionListResponse,
  PushSubscriptionRemovalResponse,
  PushSubscriptionSummary
} from "@deskcue/protocol";

export type RegisterPushSubscriptionPayload = RegisterPushSubscriptionInput;

export type RemovePushSubscriptionPayload = RemovePushSubscriptionInput;

/** Safe browser metadata shared with the daemon; it deliberately excludes endpoint and keys. */
export type {
  PushSubscriptionListResponse,
  PushSubscriptionRemovalResponse as PushSubscriptionRemovalByIdResponse,
  PushSubscriptionSummary
};

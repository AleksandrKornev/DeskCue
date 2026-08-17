import clsx from "clsx";
import { useState } from "react";

import type { PushSubscriptionSummary } from "@api/endpoint/notifications/types";
import { Modal } from "@components/Modal";
import { ConfirmDialog } from "@components/ModalDialog";
import type * as PushNotificationsService from "@modules/settings/notifications/NotificationSettingsTab/pushNotificationsService";
import styles from "@modules/settings/notifications/NotificationSettingsTab/styles.module.scss";

import { formatPushTimestamp } from "./helpers";

export type WebPushProviderSettingsProps = {
  currentPushSubscribed: boolean;
  disablingPush: boolean;
  effectivePushSupport: ReturnType<typeof PushNotificationsService.readPushSupportState>;
  enablingPush: boolean;
  pushPermission: string;
  pushStatus: string;
  pushSummary: string;
  reenablingPush: boolean;
  otherPushSubscriptions: PushSubscriptionSummary[];
  removingPushSubscriptionId: string | null;
  onDisablePush: () => void;
  onEnablePush: () => void;
  onReenablePush: () => void;
  onRemoveOtherPushSubscription: (id: string) => Promise<void>;
};

export function WebPushProviderSettings({
  currentPushSubscribed,
  disablingPush,
  effectivePushSupport,
  enablingPush,
  pushPermission,
  pushStatus,
  pushSummary,
  reenablingPush,
  otherPushSubscriptions,
  removingPushSubscriptionId,
  onDisablePush,
  onEnablePush,
  onReenablePush,
  onRemoveOtherPushSubscription
}: WebPushProviderSettingsProps) {
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false);
  const [subscriptionToRemove, setSubscriptionToRemove] = useState<PushSubscriptionSummary | null>(null);
  const disabled =
    enablingPush ||
    disablingPush ||
    reenablingPush ||
    pushPermission === "unsupported" ||
    !effectivePushSupport.supported;
  const isInsecureContext =
    !effectivePushSupport.supported && effectivePushSupport.code === "insecure_context";

  return (
    <>
      {isInsecureContext ? (
        <section aria-label="Browser push requirements" className={styles.pushInsecureContext}>
          <div className={styles.pushInsecureRail} aria-hidden="true" />
          <div className={styles.pushInsecureContent}>
            <span className={styles.pushInsecureBadge}>Needs secure connection</span>
            <strong>Browser push is unavailable on this HTTP address</strong>
            <p>Open DeskCue on HTTPS or localhost on this device to enable browser push.</p>
            <details className={styles.pushAccessOptions}>
              <summary>Why is this required?</summary>
              <p>Browsers allow push subscriptions only from a secure context to protect notification permissions.</p>
            </details>
          </div>
        </section>
      ) : (
        <p className={styles.pushSummary}>{pushSummary}</p>
      )}
      <div className={styles.providerActions}>
        <button
          className={clsx(
            styles.inlineButton,
            currentPushSubscribed && styles.inlineDangerButton
          )}
          disabled={disabled}
          onClick={currentPushSubscribed ? onDisablePush : onEnablePush}
          type="button"
        >
          {currentPushSubscribed
            ? disablingPush ? "Disabling..." : "Disable browser push"
            : enablingPush ? "Enabling..." : "Enable browser push"}
        </button>
        {currentPushSubscribed ? (
          <button
            className={styles.inlineButton}
            disabled={disabled}
            onClick={onReenablePush}
            type="button"
          >
            {reenablingPush ? "Re-enabling..." : "Re-enable"}
          </button>
        ) : null}
        {otherPushSubscriptions.length > 0 ? (
          <button
            className={styles.inlineButton}
            onClick={() => setSessionsDialogOpen(true)}
            type="button"
          >
            Manage push sessions ({otherPushSubscriptions.length})
          </button>
        ) : null}
      </div>
      {pushStatus ? <p className={styles.status}>{pushStatus}</p> : null}
      <Modal
        bodyClassName={styles.pushSessionsModalBody}
        description="Stop DeskCue deliveries to saved push sessions. Browser notification permission stays under the browser's control."
        isOpen={sessionsDialogOpen && subscriptionToRemove === null}
        size="default"
        title="Manage push sessions"
        onClose={() => {
          if (!removingPushSubscriptionId) {
            setSessionsDialogOpen(false);
          }
        }}
      >
        {otherPushSubscriptions.length > 0 ? (
          <section aria-label="Other browsers with push" className={styles.pushSubscriptionList}>
            <div className={styles.pushSubscriptionListHeader}>
              <div>
                <strong>Other browsers with push</strong>
                <span>Stopping a session removes its saved push endpoint from DeskCue.</span>
              </div>
            </div>
            <ul>
              {otherPushSubscriptions.map((subscription) => (
                <li key={subscription.id}>
                  <div>
                    <strong>{subscription.label}</strong>
                    <span>
                      Connected {formatPushTimestamp(subscription.createdAt)}
                      {subscription.lastDeliveredAt
                        ? ` · Last delivery ${formatPushTimestamp(subscription.lastDeliveredAt)}`
                        : " · No deliveries yet"}
                    </span>
                  </div>
                  <button
                    className={clsx(styles.inlineButton, styles.inlineDangerButton)}
                    disabled={Boolean(removingPushSubscriptionId)}
                    onClick={() => setSubscriptionToRemove(subscription)}
                    type="button"
                  >
                    {removingPushSubscriptionId === subscription.id ? "Stopping..." : "Stop push"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className={styles.pushSessionsEmpty}>All other browser sessions have been stopped.</p>
        )}
      </Modal>
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Stop push"
        confirmingLabel="Stopping..."
        description={subscriptionToRemove
          ? `DeskCue will remove the saved push session for ${subscriptionToRemove.label}. Its notification permission will not be changed.`
          : ""}
        isConfirming={removingPushSubscriptionId === subscriptionToRemove?.id}
        isOpen={subscriptionToRemove !== null}
        title="Stop this push session?"
        tone="danger"
        onCancel={() => {
          if (!removingPushSubscriptionId) {
            setSubscriptionToRemove(null);
          }
        }}
        onConfirm={async () => {
          if (!subscriptionToRemove) {
            return;
          }

          await onRemoveOtherPushSubscription(subscriptionToRemove.id);
          setSubscriptionToRemove(null);
        }}
      />
    </>
  );
}

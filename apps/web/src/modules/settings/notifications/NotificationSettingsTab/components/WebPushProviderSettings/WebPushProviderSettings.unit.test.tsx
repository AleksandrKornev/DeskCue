import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { WebPushProviderSettings } from "./WebPushProviderSettings";

it("shows a recovery path instead of retrying a denied browser permission", () => {
  render(
    <WebPushProviderSettings
      currentPushSubscribed={false}
      disablingPush={false}
      effectivePushSupport={{ code: "supported", reason: null, supported: true }}
      enablingPush={false}
      otherPushSubscriptions={[]}
      pushPermission="denied"
      pushStatus=""
      pushSummary="This browser is not subscribed"
      reenablingPush={false}
      removingPushSubscriptionId={null}
      onDisablePush={vi.fn()}
      onEnablePush={vi.fn()}
      onReenablePush={vi.fn()}
      onRemoveOtherPushSubscription={vi.fn()}
    />
  );

  expect(screen.getByRole("region", { name: "Browser push requirements" })).toHaveTextContent(
    "Browser notifications are blocked"
  );

  expect(screen.getByRole("button", { name: "Enable browser push" })).toBeDisabled();
  expect(screen.getByText(/site permissions/i)).toBeInTheDocument();
});

it("keeps subscription cleanup available when permission was revoked", () => {
  render(
    <WebPushProviderSettings
      currentPushSubscribed
      disablingPush={false}
      effectivePushSupport={{ code: "supported", reason: null, supported: true }}
      enablingPush={false}
      otherPushSubscriptions={[]}
      pushPermission="denied"
      pushStatus=""
      pushSummary="This browser is subscribed"
      reenablingPush={false}
      removingPushSubscriptionId={null}
      onDisablePush={vi.fn()}
      onEnablePush={vi.fn()}
      onReenablePush={vi.fn()}
      onRemoveOtherPushSubscription={vi.fn()}
    />
  );

  expect(screen.getByRole("button", { name: "Disable browser push" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Re-enable" })).toBeDisabled();
});

it("prioritizes the secure-context recovery when permission is also denied", () => {
  render(
    <WebPushProviderSettings
      currentPushSubscribed={false}
      disablingPush={false}
      effectivePushSupport={{
        code: "insecure_context",
        reason: "Push requires HTTPS or localhost. This LAN HTTP page is not a secure context",
        supported: false
      }}
      enablingPush={false}
      otherPushSubscriptions={[]}
      pushPermission="denied"
      pushStatus=""
      pushSummary="This browser is not subscribed"
      reenablingPush={false}
      removingPushSubscriptionId={null}
      onDisablePush={vi.fn()}
      onEnablePush={vi.fn()}
      onReenablePush={vi.fn()}
      onRemoveOtherPushSubscription={vi.fn()}
    />
  );

  expect(screen.getByText("Needs secure connection")).toBeInTheDocument();
  expect(screen.getByText(/HTTPS or localhost/i)).toBeInTheDocument();
  expect(screen.queryByText("Permission blocked")).not.toBeInTheDocument();
});

it.each([
  ["Notifications", {
    code: "notifications_unavailable",
    reason: "Notifications are not supported in this browser",
    supported: false
  }],
  ["service worker", {
    code: "service_worker_unavailable",
    reason: "Service workers are not supported in this browser",
    supported: false
  }],
  ["PushManager", {
    code: "push_manager_unavailable",
    reason: "PushManager is not supported in this browser",
    supported: false
  }]
] as const)("prioritizes the %s capability failure over denied permission", (_label, support) => {
  render(
    <WebPushProviderSettings
      currentPushSubscribed
      disablingPush={false}
      effectivePushSupport={support}
      enablingPush={false}
      otherPushSubscriptions={[]}
      pushPermission="denied"
      pushStatus=""
      pushSummary="This browser is subscribed"
      reenablingPush={false}
      removingPushSubscriptionId={null}
      onDisablePush={vi.fn()}
      onEnablePush={vi.fn()}
      onReenablePush={vi.fn()}
      onRemoveOtherPushSubscription={vi.fn()}
    />
  );

  expect(screen.getByText("Browser unsupported")).toBeInTheDocument();
  expect(screen.getByText(new RegExp(support.reason, "i"))).toBeInTheDocument();
  expect(screen.queryByText("Permission blocked")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Disable browser push" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Re-enable" })).toBeDisabled();
});

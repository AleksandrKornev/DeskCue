import { makeAutoObservable, observable, runInAction } from "mobx";

import type { PushSubscriptionSummary } from "@deskcue/protocol";

import {
  formatPushSubscriptionCount,
  readPushError
} from "./helpers";
import { notificationPushController } from "./pushController";
import type { NotificationPushController } from "./pushController";

export class NotificationPushStore {
  currentPushSubscribed = false;
  disablingPush = false;
  enablingPush = false;
  loadingPushStatus = false;
  pushPermission: NotificationPermission | "unsupported";
  pushStatus = "";
  pushSubscriptionCount = 0;
  pushSubscriptions: PushSubscriptionSummary[] = [];
  pushSupport: ReturnType<NotificationPushController["readPushSupportState"]>;
  removingPushSubscriptionId: string | null = null;
  reenablingPush = false;
  private pushStatusRequest: Promise<void> | null = null;
  private readonly controller: NotificationPushController;
  private requestGeneration = 0;

  constructor(controller: NotificationPushController = notificationPushController) {
    this.controller = controller;
    this.pushPermission = controller.readPushPermissionState();
    this.pushSupport = controller.readPushSupportState();
    makeAutoObservable<this, "controller" | "pushStatusRequest" | "requestGeneration">(
      this,
      {
        controller: false,
        pushStatusRequest: false,
        requestGeneration: false,
        pushSupport: observable.ref
      },
      {
        autoBind: true
      }
    );
  }

  get pushSummary() {
    if (this.loadingPushStatus) {
      return "Checking push status...";
    }

    if (this.pushPermission === "unsupported") {
      return "Not supported in this browser";
    }

    if (!this.pushSupport.supported) {
      return this.pushSupport.reason;
    }

    if (this.currentPushSubscribed) {
      return `This browser is subscribed. ${formatPushSubscriptionCount(this.pushSubscriptionCount)}`;
    }

    if (this.pushSubscriptionCount > 0) {
      return `This browser is not subscribed. ${formatPushSubscriptionCount(this.pushSubscriptionCount)}`;
    }

    return "This browser is not subscribed";
  }

  get otherPushSubscriptions() {
    return this.pushSubscriptions.filter((subscription) => !subscription.current);
  }

  async loadPushStatus(options: { force?: boolean } = {}) {
    if (this.pushStatusRequest !== null) {
      if (!options.force) {
        return this.pushStatusRequest;
      }

      await this.pushStatusRequest;
      const queuedRequest = this.pushStatusRequest;
      if (queuedRequest !== null) {
        return queuedRequest;
      }
    }

    const request = this.fetchPushStatus();
    this.pushStatusRequest = request;

    try {
      await request;
    } finally {
      this.pushStatusRequest = null;
    }
  }

  private async fetchPushStatus() {
    const generation = this.requestGeneration;
    this.loadingPushStatus = true;

    try {
      const [result, subscriptionList] = await Promise.all([
        this.controller.getPushStatus(),
        this.controller.listPushSubscriptions(this.controller.getPushClientId())
      ]);
      if (generation !== this.requestGeneration) return;

      runInAction(() => {
        this.pushSubscriptionCount = subscriptionList.subscriptionCount ?? result.subscriptionCount;
        this.pushSubscriptions = subscriptionList.subscriptions;
        this.currentPushSubscribed = subscriptionList.subscriptions.some((subscription) => subscription.current);
        this.pushPermission = this.controller.readPushPermissionState();
        this.pushSupport = this.controller.readPushSupportState();
      });
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.pushStatus = error instanceof Error ? error.message : "Failed to load push status";
      });
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.loadingPushStatus = false;
        });
      }
    }
  }

  async enablePush() {
    const generation = this.requestGeneration;
    this.enablingPush = true;
    this.pushStatus = "";

    try {
      const result = await this.controller.enablePushNotifications();
      if (generation !== this.requestGeneration) return;
      if (result.ok) {
        runInAction(() => {
          this.pushSubscriptionCount = result.data.subscriptionCount;
        });
        await this.refreshPushState();
        if (generation !== this.requestGeneration) return;
        runInAction(() => {
          this.pushStatus = "Push notifications enabled for this device";
        });
        return;
      }

      runInAction(() => {
        this.pushStatus = readPushError(result, "Failed to enable push notifications");
      });
      await this.refreshPushState();
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.pushStatus = error instanceof Error ? error.message : "Failed to enable push notifications";
      });
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.enablingPush = false;
        });
      }
    }
  }

  async reenablePush() {
    const generation = this.requestGeneration;
    this.reenablingPush = true;
    this.pushStatus = "";

    try {
      const result = await this.controller.enablePushNotifications({ forceRenew: true });
      if (generation !== this.requestGeneration) return;
      if (result.ok) {
        runInAction(() => {
          this.pushSubscriptionCount = result.data.subscriptionCount;
        });
        await this.refreshPushState();
        if (generation !== this.requestGeneration) return;
        runInAction(() => {
          this.pushStatus = "Push notifications re-enabled for this device";
        });
        return;
      }

      runInAction(() => {
        this.pushStatus = readPushError(result, "Failed to re-enable push notifications");
      });
      await this.refreshPushState();
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.pushStatus = error instanceof Error ? error.message : "Failed to re-enable push notifications";
      });
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.reenablingPush = false;
        });
      }
    }
  }

  async disablePush() {
    const generation = this.requestGeneration;
    this.disablingPush = true;
    this.pushStatus = "";

    try {
      const result = await this.controller.disablePushNotifications();
      if (generation !== this.requestGeneration) return;
      if (result.ok) {
        runInAction(() => {
          this.pushSubscriptionCount = result.data.subscriptionCount;
        });
        await this.refreshPushState();
        if (generation !== this.requestGeneration) return;
        runInAction(() => {
          this.pushStatus = "Push notifications disabled for this browser";
        });
        return;
      }

      runInAction(() => {
        this.pushStatus = result.data.error ?? "Failed to disable push notifications";
      });
      await this.refreshPushState();
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.pushStatus = error instanceof Error ? error.message : "Failed to disable push notifications";
      });
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.disablingPush = false;
        });
      }
    }
  }

  async removeOtherPushSubscription(id: string) {
    if (this.removingPushSubscriptionId) {
      return;
    }

    const generation = this.requestGeneration;
    this.removingPushSubscriptionId = id;
    this.pushStatus = "";

    try {
      const result = await this.controller.removePushSubscriptionById(id);
      if (generation !== this.requestGeneration) return;
      if (result.ok) {
        await this.loadPushStatus({ force: true });
        if (generation !== this.requestGeneration) return;
        runInAction(() => {
          this.pushStatus = "Push notifications stopped";
        });
        return;
      }

      runInAction(() => {
        this.pushStatus = result.data.error ?? "Failed to stop push notifications";
      });
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      runInAction(() => {
        this.pushStatus = error instanceof Error ? error.message : "Failed to stop push notifications";
      });
    } finally {
      if (generation === this.requestGeneration) {
        runInAction(() => {
          this.removingPushSubscriptionId = null;
        });
      }
    }
  }

  private async refreshPushState() {
    await this.loadPushStatus({ force: true });
    runInAction(() => {
      this.pushPermission = this.controller.readPushPermissionState();
      this.pushSupport = this.controller.readPushSupportState();
    });
  }

  resetForConnectionChange() {
    this.requestGeneration += 1;
    this.currentPushSubscribed = false;
    this.disablingPush = false;
    this.enablingPush = false;
    this.loadingPushStatus = false;
    this.pushPermission = this.controller.readPushPermissionState();
    this.pushStatus = "";
    this.pushSubscriptionCount = 0;
    this.pushSubscriptions = [];
    this.pushSupport = this.controller.readPushSupportState();
    this.reenablingPush = false;
    this.removingPushSubscriptionId = null;
    this.pushStatusRequest = null;
  }
}

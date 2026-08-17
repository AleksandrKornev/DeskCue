type CloseableService = {
  close: () => Promise<void> | void;
};

type DaemonServiceLifecycleOptions<
  Application extends CloseableService,
  Notifications extends CloseableService
> = {
  closeAccessStore: () => void;
  closeSqliteContext: () => void;
  createApplication: () => Promise<Application>;
  createNotifications: (application: Application) => Promise<Notifications>;
};

export type DaemonServiceLifecycle<
  Application extends CloseableService,
  Notifications extends CloseableService
> = {
  application: Application;
  close: () => Promise<void>;
  notifications: Notifications;
};

async function closeCreatedServices({
  application,
  closeAccessStore,
  closeSqliteContext,
  notifications
}: {
  application: CloseableService | null;
  closeAccessStore: () => void;
  closeSqliteContext: () => void;
  notifications: CloseableService | null;
}) {
  const failures: unknown[] = [];

  // Stop producers first so their final events can still enter the durable
  // notification outbox before the notification service is drained.
  if (application) {
    try {
      await application.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (notifications) {
    try {
      await notifications.close();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    closeAccessStore();
  } catch (error) {
    failures.push(error);
  }
  // Repositories borrow the production context. Close its physical
  // connection only after every service has released its statements.
  try {
    closeSqliteContext();
  } catch (error) {
    failures.push(error);
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "One or more daemon services failed to close.");
  }
}

/**
 * Creates the stateful daemon services as one ownership unit. A failed stage
 * rolls back every earlier stage, while normal shutdown reuses the exact same
 * drain order and idempotent close promise.
 */
export async function createDaemonServiceLifecycle<
  Application extends CloseableService,
  Notifications extends CloseableService
>(
  options: DaemonServiceLifecycleOptions<Application, Notifications>
): Promise<DaemonServiceLifecycle<Application, Notifications>> {
  let application: Application | null = null;
  let notifications: Notifications | null = null;
  let closePromise: Promise<void> | null = null;

  const close = () => {
    closePromise ??= closeCreatedServices({
      application,
      closeAccessStore: options.closeAccessStore,
      closeSqliteContext: options.closeSqliteContext,
      notifications
    });
    return closePromise;
  };

  try {
    application = await options.createApplication();
    notifications = await options.createNotifications(application);
  } catch (startupError) {
    try {
      await close();
    } catch (rollbackError) {
      throw new AggregateError(
        [startupError, rollbackError],
        "Daemon service startup failed and its rollback was incomplete."
      );
    }
    throw startupError;
  }

  return {
    application,
    close,
    notifications
  };
}

export type ManagedShutdownReason = "host-request" | "host-shutdown";

type ManagedShutdownController = {
  close: () => Promise<void>;
};

type ManagedShutdownOptions = {
  awaitController: () => Promise<ManagedShutdownController | null>;
  disconnect: () => void;
  flush: () => Promise<void>;
  reportFailure: (error: unknown, reason: ManagedShutdownReason) => void;
  sendStopped: () => void;
  setExitCode: (exitCode: number) => void;
};

export function createManagedShutdown(options: ManagedShutdownOptions) {
  let shutdownPromise: Promise<void> | null = null;

  return (reason: ManagedShutdownReason) => {
    shutdownPromise ??= options.awaitController()
      .then((controller) => controller?.close())
      .then(() => {
        options.sendStopped();
        options.setExitCode(0);
      })
      .catch((error) => {
        options.reportFailure(error, reason);
        options.setExitCode(1);
      })
      .finally(async () => {
        await options.flush().catch(() => undefined);
        options.disconnect();
      });

    return shutdownPromise;
  };
}

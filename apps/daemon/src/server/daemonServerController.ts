import type { Server } from "node:http";

export function createControllerClose(
  closeServer: () => Promise<void>,
  disposeProcessHandlers: () => void
) {
  let closePromise: Promise<void> | null = null;

  return () => {
    closePromise ??= Promise.resolve()
      .then(closeServer)
      .finally(disposeProcessHandlers);
    return closePromise;
  };
}

export function createRealtimeThenStartCloudIngress<Realtime>({
  createRealtime,
  server,
  setRealtime,
  startCloudIngress
}: {
  createRealtime: () => Realtime;
  server: Pick<Server, "listening">;
  setRealtime: (realtime: Realtime) => void;
  startCloudIngress: () => void;
}) {
  if (!server.listening) {
    throw new Error("Cloud ingress requires a listening DeskCue HTTP server.");
  }
  const realtime = createRealtime();
  setRealtime(realtime);
  startCloudIngress();
  return realtime;
}

export function createCombinedDisposer(disposers: Array<() => void>) {
  let disposed = false;

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const dispose of disposers) {
      dispose();
    }
  };
}

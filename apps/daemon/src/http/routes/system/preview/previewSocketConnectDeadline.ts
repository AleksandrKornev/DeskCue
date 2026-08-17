import type { Socket } from "node:net";

type PendingConnectCallbacks = {
  callbacks: Set<() => void>;
  settle: () => void;
};

const pendingConnectCallbacks = new WeakMap<Socket, PendingConnectCallbacks>();

export function waitForPreviewSocketConnect(socket: Socket, callback: () => void) {
  if (!socket.connecting) {
    callback();

    return () => undefined;
  }

  let pending = pendingConnectCallbacks.get(socket);
  if (!pending) {
    const callbacks = new Set<() => void>();
    const settle = () => {
      socket.removeListener("connect", settle);
      socket.removeListener("close", settle);
      pendingConnectCallbacks.delete(socket);
      for (const pendingCallback of callbacks) pendingCallback();
      callbacks.clear();
    };
    pending = { callbacks, settle };
    pendingConnectCallbacks.set(socket, pending);
    socket.once("connect", settle);
    socket.once("close", settle);
  }

  pending.callbacks.add(callback);

  return () => {
    pending?.callbacks.delete(callback);
    if (pending?.callbacks.size !== 0) return;
    socket.removeListener("connect", pending.settle);
    socket.removeListener("close", pending.settle);
    pendingConnectCallbacks.delete(socket);
  };
}

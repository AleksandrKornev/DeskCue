export const API_UNAUTHORIZED_EVENT = "deskcue:api-unauthorized";
export const CONNECTION_CONFIG_CHANGED_EVENT = "deskcue:connection-config-changed";

let connectionEpoch = 0;
let observedWindow: Window | null = null;

function observeConnectionChanges() {
  if (typeof window === "undefined" || observedWindow === window) {
    return;
  }

  observedWindow = window;
  window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, () => {
    connectionEpoch += 1;
  });
}

export function readConnectionEpoch() {
  observeConnectionChanges();
  return connectionEpoch;
}

export function isConnectionEpochCurrent(epoch: number) {
  return readConnectionEpoch() === epoch;
}

export function emitUnauthorizedEvent(expectedEpoch = readConnectionEpoch()) {
  if (!isConnectionEpochCurrent(expectedEpoch)) {
    return false;
  }
  window.dispatchEvent(new Event(API_UNAUTHORIZED_EVENT));
  return true;
}

export function emitConnectionConfigChangedEvent() {
  observeConnectionChanges();
  window.dispatchEvent(new Event(CONNECTION_CONFIG_CHANGED_EVENT));
}

import {
  useEffect,
  useState
} from "react";

import {
  CONNECTION_CONFIG_CHANGED_EVENT,
  readConnectionEpoch
} from "@api/connection/events";

/** Bridges the browser connection lifecycle into ordinary React state. */
export function useConnectionEpoch() {
  const [connectionEpoch, setConnectionEpoch] = useState(readConnectionEpoch);

  useEffect(() => {
    const updateConnectionEpoch = () => setConnectionEpoch(readConnectionEpoch());
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, updateConnectionEpoch);
    return () => {
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, updateConnectionEpoch);
    };
  }, []);

  return connectionEpoch;
}

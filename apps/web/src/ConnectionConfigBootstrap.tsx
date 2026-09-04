import { useEffect, useState } from "react";
import { useLocation } from "react-router";

import { prepareConnectionConfig } from "@api/connection/pairing";
import { RouteLoadingShell } from "@modules/appShell";
import { useDeskCueRuntime } from "@runtime";

import App from "./App";

export function ConnectionConfigBootstrap() {
  const location = useLocation();
  const runtime = useDeskCueRuntime();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    prepareConnectionConfig()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setIsReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isReady) {
    return (
      <RouteLoadingShell
        pathname={runtime.readAppPath(location.pathname)}
        search={location.search}
      />
    );
  }

  return <App />;
}

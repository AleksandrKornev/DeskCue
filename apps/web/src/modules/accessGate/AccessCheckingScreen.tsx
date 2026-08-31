import { useLocation } from "react-router";

import { RouteLoadingShell } from "@modules/appShell";
import { useDeskCueRuntime } from "@runtime";

export function AccessCheckingScreen() {
  const location = useLocation();
  const runtime = useDeskCueRuntime();

  return (
    <RouteLoadingShell
      pathname={runtime.readAppPath(location.pathname)}
      search={location.search}
    />
  );
}

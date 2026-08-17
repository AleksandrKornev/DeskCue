import { useLocation } from "react-router";

import { RouteLoadingShell } from "@modules/appShell";

export function AccessCheckingScreen() {
  const location = useLocation();

  return (
    <RouteLoadingShell
      pathname={location.pathname}
      search={location.search}
    />
  );
}

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { AccessCheckingScreen } from "./AccessCheckingScreen";
import { readReturnPath } from "./helpers";
import { useAccessGateController } from "./useAccessGateController";

export function AccessGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const accessState = useAccessGateController(location.pathname);

  if (accessState === "checking") {
    return <AccessCheckingScreen />;
  }

  if (accessState === "unauthorized" || accessState === "offline") {
    if (location.pathname === "/connect") {
      return <>{children}</>;
    }

    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate replace to={`/connect?from=${encodeURIComponent(from)}`} />;
  }

  if (location.pathname === "/connect") {
    const from = readReturnPath(location.search);
    return <Navigate replace to={from || "/"} />;
  }

  return <>{children}</>;
}

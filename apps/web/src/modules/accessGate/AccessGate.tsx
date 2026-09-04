import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { readConnectionPreparationFailure } from "@api/connection/pairing";

import { AccessCheckingScreen } from "./AccessCheckingScreen";
import { readConnectionPreparationKind, readReturnPath } from "./helpers";
import { useAccessGateController } from "./useAccessGateController";

type AccessRequiredReason = "offline" | "preparation" | "unauthorized";

function hasPendingConnectionPreparation(pathname: string, search: string) {
  if (pathname !== "/connect") return false;

  const query = new URLSearchParams(search);
  const reason = query.get("reason");
  const returnPath = readReturnPath(search);

  return (
    (reason === "offline" || reason === "preparation") &&
    Boolean(returnPath && readConnectionPreparationKind(returnPath))
  );
}

function buildAccessRequiredUrl(
  pathname: string,
  search: string,
  hash: string,
  reason: AccessRequiredReason
) {
  const query = new URLSearchParams();
  const currentPath = `${pathname}${search}${hash}`;
  const candidateReturnPath = pathname !== "/connect"
    ? currentPath
    : (reason === "offline" || reason === "preparation") &&
        readConnectionPreparationKind(currentPath)
      ? currentPath
      : readReturnPath(search);
  const returnPath = reason === "unauthorized" && candidateReturnPath &&
    readConnectionPreparationKind(candidateReturnPath)
    ? null
    : candidateReturnPath;

  if (returnPath) query.set("from", returnPath);
  query.set("reason", reason);

  return `/connect?${query.toString()}`;
}

export function AccessGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const accessState = useAccessGateController(location.pathname);
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const connectionPreparationFailure = readConnectionPreparationFailure();
  const directPreparationKind = readConnectionPreparationKind(currentPath);
  const isPreparationFailureRoute = location.pathname === "/connect" &&
    new URLSearchParams(location.search).get("reason") === "preparation-failed";

  if (accessState === "checking") {
    return <AccessCheckingScreen />;
  }

  if (
    isPreparationFailureRoute &&
    connectionPreparationFailure &&
    !connectionPreparationFailure.retryOriginal
  ) {
    return <>{children}</>;
  }

  if (connectionPreparationFailure) {
    if (!connectionPreparationFailure.retryOriginal) {
      return <Navigate replace to="/connect?reason=preparation-failed" />;
    }

    if (directPreparationKind) return (
      <Navigate
        replace
        to={buildAccessRequiredUrl(
          location.pathname,
          location.search,
          location.hash,
          "preparation"
        )}
      />
    );
  }

  if (accessState === "unauthorized" || accessState === "offline") {
    const reason = accessState === "unauthorized" &&
      hasPendingConnectionPreparation(location.pathname, location.search)
      ? "preparation"
      : accessState;
    const accessRequiredUrl = buildAccessRequiredUrl(
      location.pathname,
      location.search,
      location.hash,
      reason
    );

    if (`${location.pathname}${location.search}` === accessRequiredUrl) {
      return <>{children}</>;
    }

    return <Navigate replace to={accessRequiredUrl} />;
  }

  if (hasPendingConnectionPreparation(location.pathname, location.search)) {
    const preparationUrl = buildAccessRequiredUrl(
      location.pathname,
      location.search,
      location.hash,
      "preparation"
    );

    if (`${location.pathname}${location.search}` === preparationUrl) {
      return <>{children}</>;
    }

    return <Navigate replace to={preparationUrl} />;
  }

  if (location.pathname === "/connect") {
    const from = readReturnPath(location.search);

    return <Navigate replace to={from || "/"} />;
  }

  return <>{children}</>;
}

import type {
  InitialManagedSessionLoadState,
  ManagedSessionLoadOutcome
} from "./types";

export const INITIAL_MANAGED_SESSION_RECOVERY_MESSAGE =
  "The session may have changed or the local daemon may be unavailable.";

export function beginInitialManagedSessionLoad(
  current: InitialManagedSessionLoadState,
  force: boolean
): InitialManagedSessionLoadState {
  if (
    force &&
    (current.kind === "error" || current.kind === "missing" || current.kind === "retrying")
  ) {
    return {
      kind: "retrying",
      message: current.kind === "missing"
        ? INITIAL_MANAGED_SESSION_RECOVERY_MESSAGE
        : current.message
    };
  }

  return { kind: "loading" };
}

export function toInitialManagedSessionLoadState(
  outcome: ManagedSessionLoadOutcome
): InitialManagedSessionLoadState {
  if (outcome.kind === "loaded") {
    return { kind: "loaded" };
  }

  if (outcome.kind === "missing") {
    return { kind: "missing" };
  }

  if (outcome.kind === "superseded") {
    return { kind: "loading" };
  }

  return { kind: "error", message: outcome.message };
}

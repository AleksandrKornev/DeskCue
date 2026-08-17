import type {
  InitialManagedSessionLoadState,
  ManagedSessionLoadOutcome
} from "./types";

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

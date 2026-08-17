import { useContext } from "react";

import { DeskCueRuntimeContext } from "./DeskCueRuntimeContext";

export function useDeskCueRuntime() {
  const runtime = useContext(DeskCueRuntimeContext);
  if (!runtime) {
    throw new Error("DeskCueRuntimeProvider is missing.");
  }
  return runtime;
}

import { useContext } from "react";

import {
  DeskCueEmbeddedReadyContext,
  DeskCueLayoutModeContext
} from "./DeskCueLayoutModeContext";

export type { DeskCueLayoutMode } from "./DeskCueLayoutModeContext";

export function useDeskCueLayoutMode() {
  return useContext(DeskCueLayoutModeContext);
}

export function useDeskCueEmbeddedReady() {
  return useContext(DeskCueEmbeddedReadyContext);
}

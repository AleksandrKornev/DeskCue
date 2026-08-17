import { createContext, useContext } from "react";

export type DeskCueLayoutMode = "embedded" | "viewport";

export const DeskCueLayoutModeContext = createContext<DeskCueLayoutMode>("viewport");
export const DeskCueEmbeddedReadyContext = createContext<(() => void) | undefined>(undefined);

export function useDeskCueLayoutMode() {
  return useContext(DeskCueLayoutModeContext);
}

export function useDeskCueEmbeddedReady() {
  return useContext(DeskCueEmbeddedReadyContext);
}

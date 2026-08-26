import type { ReactNode } from "react";

import {
  DeskCueEmbeddedReadyContext,
  DeskCueLayoutModeContext
} from "./DeskCueLayoutModeContext";
import type { DeskCueLayoutMode } from "./DeskCueLayoutModeContext";

export function DeskCueLayoutModeProvider({
  children,
  mode,
  onEmbeddedReady
}: {
  children: ReactNode;
  mode: DeskCueLayoutMode;
  onEmbeddedReady?: () => void;
}) {
  return (
    <DeskCueLayoutModeContext.Provider value={mode}>
      <DeskCueEmbeddedReadyContext.Provider value={onEmbeddedReady}>
        {children}
      </DeskCueEmbeddedReadyContext.Provider>
    </DeskCueLayoutModeContext.Provider>
  );
}

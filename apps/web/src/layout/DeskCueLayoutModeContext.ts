import { createContext } from "react";

export type DeskCueLayoutMode = "embedded" | "viewport";

export const DeskCueLayoutModeContext = createContext<DeskCueLayoutMode>("viewport");
export const DeskCueEmbeddedReadyContext = createContext<(() => void) | undefined>(undefined);

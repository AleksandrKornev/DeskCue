import { createContext } from "react";

import type { DeskCueRuntime } from "./types";

export const DeskCueRuntimeContext = createContext<DeskCueRuntime | null>(null);

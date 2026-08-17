import { createContext } from "react";

import type { SettingsPageStore } from "@modules/settings/store";

export const SettingsPageContext = createContext<SettingsPageStore | null>(null);

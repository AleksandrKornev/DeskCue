import { useContext } from "react";

import { SettingsPageContext } from "./contextValue";

export function useSettingsPageContext() {
  const value = useContext(SettingsPageContext);

  if (!value) {
    throw new Error("useSettingsPageContext must be used within SettingsPageProvider");
  }

  return value;
}

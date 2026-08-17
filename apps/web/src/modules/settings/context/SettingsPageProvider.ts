import { createElement } from "react";
import type { ReactNode } from "react";

import type { SettingsPageStore } from "@modules/settings/store";

import { SettingsPageContext } from "./contextValue";

export type SettingsPageProviderProps = {
  children: ReactNode;
  value: SettingsPageStore;
};

export function SettingsPageProvider({
  children,
  value
}: SettingsPageProviderProps) {
  return createElement(SettingsPageContext.Provider, { value }, children);
}

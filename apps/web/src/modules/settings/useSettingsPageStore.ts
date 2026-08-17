import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";

import { CONNECTION_CONFIG_CHANGED_EVENT } from "@api/connection";

import { resolveSettingsTab } from "./helpers";
import { SettingsPageStore } from "./store";

export function useSettingsPageStore() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = resolveSettingsTab(tabParam) ?? "access";
  const storeRef = useRef<SettingsPageStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new SettingsPageStore(initialTab);
  }

  const store = storeRef.current;

  useEffect(() => {
    store.load();
    const handleConnectionConfigChanged = () => store.resetForConnectionChange();
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, handleConnectionConfigChanged);
    return () => {
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, handleConnectionConfigChanged);
      store.dispose();
    };
  }, [store]);

  useEffect(() => {
    store.setTabSearchParamWriter((nextTab) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("tab", nextTab);
        return next;
      });
    });
  }, [setSearchParams, store]);

  useEffect(() => {
    const resolvedTab = resolveSettingsTab(tabParam);
    if (resolvedTab) {
      store.syncActiveTabFromRoute(resolvedTab);
      if (resolvedTab !== tabParam) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set("tab", resolvedTab);
          return next;
        }, { replace: true });
      }
      return;
    }

    store.syncActiveTabFromRoute("access");
    if (tabParam !== null) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("tab");
        return next;
      }, { replace: true });
    }
  }, [setSearchParams, store, tabParam]);

  return store;
}

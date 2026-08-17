import { observer } from "mobx-react-lite";
import { useEffect } from "react";

import { useSettingsPageContext } from "@modules/settings/context";

import { AccessProtectionPanel } from "./components/AccessProtectionPanel";
import { CloudConnectionPanel } from "./components/CloudConnectionPanel";
import { PairDevicesPanel } from "./components/PairDevicesPanel";

export const AccessSettingsTab = observer(function AccessSettingsTab() {
  const { accessStore } = useSettingsPageContext();

  useEffect(() => {
    accessStore.loadAccessDevices();
  }, [accessStore]);

  return (
    <>
      <CloudConnectionPanel />
      <AccessProtectionPanel />
      <PairDevicesPanel />
    </>
  );
});

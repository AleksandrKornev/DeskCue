import { observer } from "mobx-react-lite";
import { useEffect } from "react";

import { useSettingsPageContext } from "@modules/settings/context";

import { AccessProtectionPanel } from "./components/AccessProtectionPanel";
import { CloudConnectionPanel } from "./components/CloudConnectionPanel";
import { DeviceAccessPanel } from "./components/DeviceAccessPanel";
import { PairDevicesPanel } from "./components/PairDevicesPanel";

export const AccessSettingsTab = observer(function AccessSettingsTab() {
  const { accessStore } = useSettingsPageContext();

  useEffect(() => {
    accessStore.loadAccessDevices();
  }, [accessStore]);

  return (
    <section
      aria-labelledby="settings-tab-access"
      id="settings-panel-access"
      role="tabpanel"
    >
      <CloudConnectionPanel />
      <PairDevicesPanel />
      <AccessProtectionPanel />
      <DeviceAccessPanel />
    </section>
  );
});

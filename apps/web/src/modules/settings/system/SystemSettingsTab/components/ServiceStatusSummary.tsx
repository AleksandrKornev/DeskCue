import { observer } from "mobx-react-lite";

import { useSettingsPageContext } from "@modules/settings/context";
import { formatExposureLevel } from "@modules/settings/system/SystemSettingsTab/helpers";
import styles from "@modules/settings/system/SystemSettingsTab/styles.module.scss";

export const ServiceStatusSummary = observer(function ServiceStatusSummary() {
  const { systemStore } = useSettingsPageContext();
  const { securityStatus, securityStatusMessage } = systemStore;

  if (!securityStatus) {
    return (
      <p className={styles.status}>
        {securityStatusMessage || "Checking service status..."}
      </p>
    );
  }

  return (
    <dl className={styles.securityGrid}>
      <div>
        <dt>Bind host</dt>
        <dd>{securityStatus.bindHost}</dd>
      </div>
      <div>
        <dt>Exposure</dt>
        <dd>{formatExposureLevel(securityStatus.exposureLevel)}</dd>
      </div>
      <div>
        <dt>Access protection</dt>
        <dd>{securityStatus.authRequired ? "On" : "Off"}</dd>
      </div>
    </dl>
  );
});

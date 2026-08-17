import { observer } from "mobx-react-lite";

import { useSettingsPageContext } from "@modules/settings/context";
import { SettingSourceDetails } from "@modules/settings/shared/SettingSourceDetails";
import {
  formatRuntimeEndpointsValue
} from "@modules/settings/system/SystemSettingsTab/helpers";
import styles from "@modules/settings/system/SystemSettingsTab/styles.module.scss";

export const RuntimeEndpointsSection = observer(function RuntimeEndpointsSection() {
  const { systemStore } = useSettingsPageContext();
  const { daemonSettings, daemonSettingsDraft } = systemStore;

  if (!daemonSettings || !daemonSettingsDraft) {
    return null;
  }

  return (
    <>
      <div className={styles.formHeader}>
        <div>
          <h3>Runtime endpoints</h3>
          <p>HTTP endpoints DeskCue probes for local model servers</p>
        </div>
        <span className={styles.filePath}>{daemonSettings.settingsFilePath}</span>
      </div>

      <label className={styles.fieldLabel}>
        <span>Ollama endpoint</span>
        <input
          className={styles.field}
          name="ollamaEndpoint"
          placeholder={daemonSettings.sources.runtimeEndpoints.defaultValue.ollamaEndpoint}
          value={daemonSettingsDraft.runtimeEndpoints.ollamaEndpoint}
          onChange={(event) => {
            systemStore.onRuntimeEndpointChange("ollamaEndpoint", event.target.value);
          }}
        />
        <small>DeskCue checks /api/tags on this base URL</small>
      </label>

      <label className={styles.fieldLabel}>
        <span>LM Studio endpoint</span>
        <input
          className={styles.field}
          name="lmStudioEndpoint"
          placeholder={daemonSettings.sources.runtimeEndpoints.defaultValue.lmStudioEndpoint}
          value={daemonSettingsDraft.runtimeEndpoints.lmStudioEndpoint}
          onChange={(event) => {
            systemStore.onRuntimeEndpointChange("lmStudioEndpoint", event.target.value);
          }}
        />
        <small>Leave default unless LM Studio server runs on a custom host or port</small>
      </label>

      <SettingSourceDetails
        source={daemonSettings.sources.runtimeEndpoints}
        valueFormatter={formatRuntimeEndpointsValue}
      />
    </>
  );
});

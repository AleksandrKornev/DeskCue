import { observer } from "mobx-react-lite";

import { useSettingsPageContext } from "@modules/settings/context";
import { SettingSourceDetails } from "@modules/settings/shared/SettingSourceDetails";
import {
  formatAgentDataRootsValue
} from "@modules/settings/system/SystemSettingsTab/helpers";
import styles from "@modules/settings/system/SystemSettingsTab/styles.module.scss";

export const AgentDataRootsSection = observer(function AgentDataRootsSection() {
  const { systemStore } = useSettingsPageContext();
  const { daemonSettings, daemonSettingsDraft } = systemStore;

  if (!daemonSettings || !daemonSettingsDraft) {
    return null;
  }

  return (
    <>
      <div className={styles.formHeader}>
        <div>
          <h3>Source locations</h3>
          <p>Local folders DeskCue scans for saved chat history</p>
        </div>
        <span className={styles.filePath}>{daemonSettings.settingsFilePath}</span>
      </div>

      <div className={styles.formHeader}>
        <div>
          <h3>Agent CLIs</h3>
          <p>Global homes used by CLI agents</p>
        </div>
      </div>

      <label className={styles.fieldLabel}>
        <span>Codex home</span>
        <input
          className={styles.field}
          name="codexHome"
          placeholder={daemonSettings.sources.agentDataRoots.defaultValue.codexHome}
          value={daemonSettingsDraft.agentDataRoots.codexHome}
          onChange={(event) => {
            systemStore.onAgentDataRootChange("codexHome", event.target.value);
          }}
        />
        <small>Contains session_index.jsonl and sessions</small>
      </label>

      <label className={styles.fieldLabel}>
        <span>Claude Code home</span>
        <input
          className={styles.field}
          name="claudeHome"
          placeholder={daemonSettings.sources.agentDataRoots.defaultValue.claudeHome}
          value={daemonSettingsDraft.agentDataRoots.claudeHome}
          onChange={(event) => {
            systemStore.onAgentDataRootChange("claudeHome", event.target.value);
          }}
        />
        <small>Contains the projects directory</small>
      </label>

      <div className={styles.formHeader}>
        <div>
          <h3>LLM runtimes with chats</h3>
          <p>Runtime app storage that also contains saved conversations</p>
        </div>
      </div>

      <label className={styles.fieldLabel}>
        <span>LM Studio home</span>
        <input
          className={styles.field}
          name="lmStudioHome"
          placeholder={daemonSettings.sources.agentDataRoots.defaultValue.lmStudioHome}
          value={daemonSettingsDraft.agentDataRoots.lmStudioHome}
          onChange={(event) => {
            systemStore.onAgentDataRootChange("lmStudioHome", event.target.value);
          }}
        />
        <small>Contains the conversations directory</small>
      </label>

      <SettingSourceDetails
        source={daemonSettings.sources.agentDataRoots}
        valueFormatter={formatAgentDataRootsValue}
      />
    </>
  );
});

import type { AccessDeviceSummary } from "@deskcue/protocol";
import styles from "@modules/settings/access/components/AccessDeviceList/styles.module.scss";

export type DeviceRenameControlProps = {
  device: AccessDeviceSummary;
  draft: string;
  editing: boolean;
  saving: boolean;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onSave: (device: AccessDeviceSummary) => Promise<void>;
  onStart: (device: AccessDeviceSummary) => void;
};

export function DeviceRenameControl({
  device,
  draft,
  editing,
  saving,
  onCancel,
  onDraftChange,
  onSave,
  onStart
}: DeviceRenameControlProps) {
  const trimmedDraft = draft.trim();
  const canSave = Boolean(trimmedDraft) && trimmedDraft.length <= 80 && trimmedDraft !== device.label;

  if (!editing) {
    return (
      <button
        className={styles.inlineButton}
        onClick={() => onStart(device)}
        type="button"
      >
        Rename
      </button>
    );
  }

  return (
    <form
      className={styles.deviceRenameForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave && !saving) {
          void onSave(device);
        }
      }}
    >
      <input
        aria-label="Device name"
        id={`access-device-label-${device.id}`}
        maxLength={80}
        name={`accessDeviceLabel-${device.id}`}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      <button
        className={styles.inlineButton}
        disabled={!canSave || saving}
        type="submit"
      >
        {saving ? "Saving..." : "Save"}
      </button>
      <button
        className={styles.inlineButton}
        disabled={saving}
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
    </form>
  );
}

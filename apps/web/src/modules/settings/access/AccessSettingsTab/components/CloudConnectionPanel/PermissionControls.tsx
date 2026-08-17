import type { UpdateCloudPermissionsInput } from "@deskcue/protocol";

import {
  getPermissionPreset,
  PERMISSION_PRESETS
} from "./permissions";
import type { PermissionDraft } from "./permissions";
import styles from "./styles.module.scss";

interface PermissionOption {
  description: string;
  key: keyof PermissionDraft;
  label: string;
}

const PERMISSION_OPTIONS: readonly PermissionOption[] = [
  {
    description: "Allows this Cloud to request bounded transcripts and diffs while the daemon is connected. You can leave this off for metadata-only monitoring.",
    key: "allowRemoteRead",
    label: "Enable Remote DeskCue session review"
  },
  {
    description: "Allows this Cloud to open the configured local Preview through an isolated, short-lived origin. Arbitrary local hosts and ports remain blocked.",
    key: "allowRemotePreview",
    label: "Allow remote app Preview"
  },
  {
    description: "Allows this Cloud to request bounded directory listings and text previews from registered workspaces. File paths and contents pass through transiently and are not persisted by DeskCue Cloud.",
    key: "allowRemoteFiles",
    label: "Allow remote workspace file browsing"
  },
  {
    description: "Allows this Cloud to send prompts and request a stop for supported agent turns. Prompt content passes through the Cloud service transiently and is not persisted there.",
    key: "allowRemoteControl",
    label: "Allow remote prompts and stop requests"
  }
];

interface PermissionPresetsProps {
  disabled?: boolean;
  onSelect(permissions: PermissionDraft): void;
  permissions: PermissionDraft;
}

interface PermissionFieldsProps {
  className?: string;
  disabled?: boolean;
  fieldClassName: string;
  onChange(patch: Partial<UpdateCloudPermissionsInput>): void;
  permissions: PermissionDraft;
}

export function PermissionPresets({
  disabled,
  onSelect,
  permissions
}: PermissionPresetsProps) {
  const activePreset = getPermissionPreset(permissions);

  return (
    <fieldset className={styles.permissionPresets}>
      <legend>Access preset</legend>
      <div className={styles.presetGrid}>
        {PERMISSION_PRESETS.map((preset) => (
          <button
            aria-pressed={activePreset === preset.id}
            className={styles.presetButton}
            disabled={disabled}
            key={preset.id}
            onClick={() => onSelect(preset.permissions)}
            type="button"
          >
            <span>
              <strong>{preset.label}</strong>
              {preset.recommended && <em>Recommended</em>}
            </span>
            <small>{preset.description}</small>
          </button>
        ))}
      </div>
      <small className={styles.presetStatus} aria-live="polite">
        {activePreset ? "You can fine-tune each permission below." : "Custom permissions selected."}
      </small>
    </fieldset>
  );
}

export function PermissionFields({
  className,
  disabled,
  fieldClassName,
  onChange,
  permissions
}: PermissionFieldsProps) {
  const fields = PERMISSION_OPTIONS.map((option) => (
    <label className={fieldClassName} key={option.key}>
      <input
        checked={permissions[option.key]}
        disabled={disabled}
        onChange={(event) => onChange({ [option.key]: event.target.checked })}
        type="checkbox"
      />
      <span>
        <strong>{option.label}</strong>
        <small>{option.description}</small>
      </span>
    </label>
  ));

  return className ? (
    <div className={className}>{fields}</div>
  ) : (
    <>{fields}</>
  );
}

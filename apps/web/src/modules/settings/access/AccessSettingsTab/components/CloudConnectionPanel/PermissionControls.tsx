import type { UpdateCloudPermissionsInput } from "@deskcue/protocol";

import { PERMISSION_OPTIONS } from "./cloudConnectionPresentation";
import {
  getPermissionPreset,
  PERMISSION_PRESETS
} from "./permissions";
import type { PermissionDraft } from "./permissions";
import styles from "./styles.module.scss";

export function PermissionPresets({
  disabled,
  onSelect,
  permissions
}: {
  disabled?: boolean;
  onSelect(permissions: PermissionDraft): void;
  permissions: PermissionDraft;
}) {
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
}: {
  className?: string;
  disabled?: boolean;
  fieldClassName: string;
  onChange(patch: Partial<UpdateCloudPermissionsInput>): void;
  permissions: PermissionDraft;
}) {
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

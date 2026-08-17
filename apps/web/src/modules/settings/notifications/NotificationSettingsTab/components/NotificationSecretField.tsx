import clsx from "clsx";

import { SecretVisibilityIcon } from "@modules/settings/notifications/NotificationSettingsTab/components/SecretVisibilityIcon";
import styles from "@modules/settings/notifications/NotificationSettingsTab/styles.module.scss";
import type { VisibleNotificationSecrets } from "@modules/settings/notifications/NotificationSettingsTab/types";

export function NotificationSecretField({
  fieldId,
  helperText,
  label,
  placeholder,
  rows,
  secretKey,
  textarea = false,
  value,
  visible,
  onChange,
  onToggleVisibility
}: {
  fieldId: string;
  helperText?: string;
  label: string;
  placeholder: string;
  rows?: number;
  secretKey: keyof VisibleNotificationSecrets;
  textarea?: boolean;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggleVisibility: (key: keyof VisibleNotificationSecrets) => void;
}) {
  const toggleLabel = `${visible ? "Hide" : "Show"} ${label}`;
  const controlClassName = clsx(
    styles.field,
    textarea && styles.textArea,
    styles.secretFieldControl,
    textarea && !visible && styles.secretTextArea
  );

  return (
    <div className={styles.fieldLabel}>
      <label htmlFor={fieldId}>{label}</label>
      <div className={styles.secretField}>
        {textarea ? (
          <textarea
            autoComplete="off"
            className={controlClassName}
            id={fieldId}
            name={fieldId}
            placeholder={placeholder}
            rows={rows}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            autoComplete="new-password"
            className={controlClassName}
            id={fieldId}
            name={fieldId}
            placeholder={placeholder}
            type={visible ? "text" : "password"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        <button
          aria-label={toggleLabel}
          aria-pressed={visible}
          className={styles.secretToggleButton}
          onClick={() => onToggleVisibility(secretKey)}
          type="button"
        >
          <SecretVisibilityIcon visible={visible} />
        </button>
      </div>
      {helperText ? <small>{helperText}</small> : null}
    </div>
  );
}

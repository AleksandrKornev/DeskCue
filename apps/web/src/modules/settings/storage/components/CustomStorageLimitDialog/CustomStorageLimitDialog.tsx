import type { SubmitEvent } from "react";

import { Modal } from "@components/Modal";

import styles from "./styles.module.scss";

export type CustomStorageLimitDialogProps = {
  customStorageMaxMb: string;
  isOpen: boolean;
  locked: boolean;
  savingStorageBudget: boolean;
  onClose: () => void;
  onCustomStorageMaxMbChange: (value: string) => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
};

export function CustomStorageLimitDialog({
  customStorageMaxMb,
  isOpen,
  locked,
  savingStorageBudget,
  onClose,
  onCustomStorageMaxMbChange,
  onSubmit
}: CustomStorageLimitDialogProps) {
  return (
    <Modal
      closeLabel="Close custom storage limit dialog"
      description="Choose a whole-number limit for the local .deskcue-data directory."
      eyebrow="Storage"
      isOpen={isOpen}
      title="Custom storage limit"
      onClose={onClose}
    >
      <form className={styles.customStorageLimitForm} onSubmit={onSubmit}>
        <label className={styles.fieldLabel}>
          <span>Limit</span>
          <div className={styles.customStorageLimitInput}>
            <input
              aria-describedby={locked ? "custom-storage-limit-lock-notice" : undefined}
              aria-label="Custom storage limit in MiB"
              className={styles.field}
              disabled={locked || savingStorageBudget}
              inputMode="numeric"
              max={500}
              min={20}
              step={1}
              type="number"
              value={customStorageMaxMb}
              onChange={(event) => { onCustomStorageMaxMbChange(event.target.value); }}
            />
            <span>MiB</span>
          </div>
          <small>From 20 to 500 MiB. DeskCue will compact local cache and logs before it reaches the limit.</small>
        </label>
        {locked ? (
          <p className={styles.lockNotice} id="custom-storage-limit-lock-notice" role="status">
            This limit is controlled by the daemon environment and cannot be changed here.
          </p>
        ) : null}
        <div className={styles.customStorageLimitActions}>
          <button
            className={styles.inlineButton}
            disabled={savingStorageBudget}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button className={styles.button} disabled={locked || savingStorageBudget} type="submit">
            {savingStorageBudget ? "Saving..." : "Save limit"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

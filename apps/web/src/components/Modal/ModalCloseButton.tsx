import clsx from "clsx";

import CloseIcon from "@assets/images/icon-close.svg?react";

import styles from "./ModalCloseButton.module.scss";

export type ModalCloseButtonProps = {
  className?: string;
  label: string;
  onClick: () => void;
};

export function ModalCloseButton({ className, label, onClick }: ModalCloseButtonProps) {
  return (
    <button
      aria-label={label}
      className={clsx(styles.button, className)}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span aria-hidden="true" className={styles.surface}>
        <CloseIcon className={styles.icon} focusable="false" />
      </span>
    </button>
  );
}

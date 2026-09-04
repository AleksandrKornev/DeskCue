import styles from "./styles.module.scss";

export type CreateLocalChatButtonProps = {
  disabled?: boolean;
  onClick: () => void;
};

export function CreateLocalChatButton({
  disabled = false,
  onClick
}: CreateLocalChatButtonProps) {
  return (
    <button
      aria-haspopup="dialog"
      className={styles.trigger}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <svg
        aria-hidden="true"
        className={styles.triggerIcon}
        focusable="false"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M5 5.5h14v10H9l-4 3v-13Z" />
        <path d="M12 8v5M9.5 10.5h5" />
      </svg>
      <span>New local chat</span>
    </button>
  );
}

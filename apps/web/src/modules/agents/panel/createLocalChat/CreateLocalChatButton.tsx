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
      <span aria-hidden="true" className={styles.triggerIcon}>+</span>
      <span>New local chat</span>
    </button>
  );
}

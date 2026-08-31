import type { ReactNode } from "react";

export type ModalSize = "confirm" | "default";

export type ModalProps = {
  bodyClassName?: string;
  children?: ReactNode;
  className?: string;
  closeLabel?: string;
  closeOnHistoryBack?: boolean;
  description?: ReactNode;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  isOpen: boolean;
  restoreFocusOnClose?: boolean;
  size?: ModalSize;
  title: ReactNode;
  titleId?: string;
  onClose: () => void;
};

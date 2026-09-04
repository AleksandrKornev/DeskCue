import type { ReactNode } from "react";

import type { ModalProps, ModalSize } from "@components/Modal";

export type ModalDialogProps = Omit<ModalProps, "footer" | "size"> & {
  actionsLayout?: "equal" | "weighted";
  actions?: ReactNode;
  size?: ModalSize;
};

export type ConfirmDialogProps = {
  cancelLabel?: string;
  confirmLabel: string;
  confirmingLabel?: string;
  description?: ReactNode;
  isConfirming?: boolean;
  isOpen: boolean;
  title: ReactNode;
  tone?: "danger" | "default";
  onCancel: () => void;
  onConfirm: () => void;
};

export type ConfirmationOptions = {
  cancelLabel?: string;
  confirmLabel: string;
  description?: string;
  title: string;
  tone?: "danger" | "default";
};

export type ConfirmationRequestLifecycle = {
  signal?: AbortSignal;
};

export type ConfirmationDialogRequest = {
  id: number;
  options: ConfirmationOptions;
  resolve: (confirmed: boolean) => void;
};

export type ConfirmationDialogCancellation = {
  id: number;
};

import type { PropsWithChildren, ReactNode } from "react";

export type PanelProps = PropsWithChildren<{
  title: string;
  action?: ReactNode;
  className?: string;
  headerHidden?: boolean;
  subtitle?: string;
}>;

export type StatusBadgeProps = {
  status: string;
  className?: string;
  label?: string;
};

export type KeyValueProps = {
  label: string;
  value: ReactNode;
  className?: string;
  valueClassName?: string;
};

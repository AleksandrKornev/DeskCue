export type AppHeaderProps = {
  discoveredCount: string;
  managedCount: number;
  runningChatCount: number;
  isBootstrapping: boolean;
  isFocusedChat?: boolean;
  isBootShell?: boolean;
  onGoHome?: () => void;
};

export type HeaderMetricKind = "threads" | "managed" | "runtime";

export type HeaderMetricProps = {
  icon: HeaderMetricKind;
  label: string;
  title: string;
  value: string | number;
};

export type HeaderMetricIconProps = {
  className: string;
  kind: HeaderMetricKind;
};

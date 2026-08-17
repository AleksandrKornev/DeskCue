export type SegmentedTabOption<TValue extends string> = {
  key: TValue;
  label: string;
};

export type SegmentedTabsProps<TValue extends string> = {
  activeTab: TValue;
  ariaLabel: string;
  className?: string;
  idPrefix?: string;
  mobileLayout?: "scroll" | "fill";
  options: SegmentedTabOption<TValue>[];
  tone?: "default" | "neutral";
  onSelectTab: (tab: TValue) => void;
};

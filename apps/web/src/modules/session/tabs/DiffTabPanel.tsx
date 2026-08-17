import { ChangesReview } from "./changes";
import type { DiffTabPanelProps } from "./types";

export function DiffTabPanel(props: DiffTabPanelProps) {
  return <ChangesReview {...props} />;
}

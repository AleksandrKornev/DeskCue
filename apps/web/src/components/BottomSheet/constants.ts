export const BOTTOM_SHEET_MEDIA_QUERY = "(max-width: 720px)";
export const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";
export const BOTTOM_SHEET_MOTION_MS = 180;
export const BOTTOM_SHEET_MIN_DISMISS_DISTANCE = 96;
export const BOTTOM_SHEET_MAX_DISMISS_DISTANCE = 160;
export const BOTTOM_SHEET_DISMISS_RATIO = 0.22;
export const BOTTOM_SHEET_FLING_DISTANCE = 32;
export const BOTTOM_SHEET_FLING_VELOCITY = 0.65;
export const BOTTOM_SHEET_EXIT_PADDING = 24;
export const BOTTOM_SHEET_HANDLE_HIT_AREA = 28;
export const BOTTOM_SHEET_DRAG_HANDLE_SELECTOR = "[data-bottom-sheet-drag-handle]";
export const BOTTOM_SHEET_INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[data-bottom-sheet-drag-ignore]"
].join(",");

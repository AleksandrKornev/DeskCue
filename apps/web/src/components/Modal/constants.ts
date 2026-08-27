export const FOCUSABLE_ELEMENT_SELECTOR = [
  "a[href]",
  "audio[controls]",
  "button:not([disabled])",
  "iframe",
  "input:not([disabled])",
  "select:not([disabled])",
  "summary",
  "textarea:not([disabled])",
  "video[controls]",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

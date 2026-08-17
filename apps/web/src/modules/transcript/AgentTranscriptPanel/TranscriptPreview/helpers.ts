export function flattenPreviewMarkdownCodeChildren(children: unknown): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children).replace(/\n$/, "");
  }

  if (Array.isArray(children)) {
    return children
      .map((child) => flattenPreviewMarkdownCodeChildren(child))
      .join("")
      .replace(/\n$/, "");
  }

  return "";
}

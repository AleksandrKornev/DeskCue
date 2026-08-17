export function safelyDecodeUriComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

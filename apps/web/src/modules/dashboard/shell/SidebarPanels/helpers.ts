export function truncateRuntimeModel(value: string, maxLength = 54) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

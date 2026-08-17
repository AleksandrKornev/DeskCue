function parseDateValue(value: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value: string) {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

export function formatCompactDate(value: string) {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

export function getChatDayKey(value: string) {
  const date = parseDateValue(value);
  if (!date) {
    return `unknown:${value || "empty"}`;
  }

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function formatChatDay(value: string) {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return "Unknown day";
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "long"
  }).format(parsed);
}

export function formatChatTime(value: string) {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return "--:--";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

export function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

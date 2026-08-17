const localTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  second: "2-digit",
  year: "numeric"
});

export function formatLogTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) {
    return "no timestamp";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return localTimestampFormatter.format(date);
}

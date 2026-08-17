export function readOptionalBooleanEnv(name: string): boolean | null {
  const rawValue = process.env[name]?.trim().toLowerCase();
  if (!rawValue) {
    return null;
  }

  if (["1", "true", "yes", "on"].includes(rawValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(rawValue)) {
    return false;
  }

  return null;
}

export function readStorageSizeMbEnv(name: string): number | null {
  const rawValue = process.env[name];
  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed >= 8 && parsed <= 500 ? parsed : null;
}

export function readCookieSecureEnv(name: string): "auto" | boolean {
  const rawValue = process.env[name]?.trim().toLowerCase();
  if (!rawValue || rawValue === "auto") {
    return "auto";
  }

  if (["1", "true", "yes", "on"].includes(rawValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(rawValue)) {
    return false;
  }

  return "auto";
}

export function readHttpCompressionEnv(name: string): "auto" | "off" {
  const rawValue = process.env[name]?.trim().toLowerCase();
  if (!rawValue || rawValue === "auto") {
    return "auto";
  }

  if (["1", "true", "yes", "on"].includes(rawValue)) {
    return "auto";
  }

  if (["0", "false", "no", "off", "disabled"].includes(rawValue)) {
    return "off";
  }

  return "auto";
}

export function readPositiveIntegerEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function readOptionalStringEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function readOptionalListEnv(name: string): string[] | null {
  const value = process.env[name];
  if (!value) {
    return null;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

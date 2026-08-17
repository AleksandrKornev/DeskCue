export function quoteForShell(value: string) {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

export const CLI_EXIT_CODES = {
  success: 0,
  failure: 1,
  usage: 2,
  inactive: 3,
  refused: 4,
  timeout: 5
} as const;

export type CliExitCode = typeof CLI_EXIT_CODES[keyof typeof CLI_EXIT_CODES];

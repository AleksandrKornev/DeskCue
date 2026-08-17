export type AppErrorCode =
  | "conflict"
  | "external_desktop_interrupt_unavailable"
  | "forbidden"
  | "invalid_input"
  | "not_accepting_input"
  | "not_found"
  | "runtime_unavailable";

const HTTP_STATUS_BY_CODE: Record<AppErrorCode, number> = {
  conflict: 409,
  external_desktop_interrupt_unavailable: 409,
  forbidden: 403,
  invalid_input: 400,
  not_accepting_input: 409,
  not_found: 404,
  runtime_unavailable: 503
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = HTTP_STATUS_BY_CODE[code];
  }
}

export function getErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode
    };
  }

  const message = error instanceof Error ? error.message : "Unexpected error.";
  return {
    code: "invalid_input" as const,
    message,
    statusCode: 400
  };
}

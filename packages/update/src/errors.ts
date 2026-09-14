export type UpdateErrorCode =
  | "apply_incomplete"
  | "artifact_hash_mismatch"
  | "artifact_size_mismatch"
  | "cancelled"
  | "check_interrupted"
  | "download_interrupted"
  | "download_failed"
  | "invalid_manifest"
  | "invalid_state"
  | "invalid_update_source"
  | "installer_launch_failed"
  | "missing_staged_artifact"
  | "operation_in_progress"
  | "staged_artifact_changed"
  | "timeout"
  | "update_not_available";

export class UpdateError extends Error {
  readonly code: UpdateErrorCode;

  constructor(code: UpdateErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UpdateError";
    this.code = code;
  }
}

export function toUpdateError(error: unknown, fallbackCode: UpdateErrorCode) {
  if (error instanceof UpdateError) return error;

  return new UpdateError(
    fallbackCode,
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? { cause: error } : undefined
  );
}

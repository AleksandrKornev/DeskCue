import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "./errors.ts";
import {
  requireNonEmptyString,
  validateCreateSessionInput,
  validatePreviewPort
} from "./serviceValidation.ts";

test("normalizes non-empty service strings", () => {
  assert.equal(requireNonEmptyString("  session-1  ", "sessionId"), "session-1");
});

test("rejects blank service strings with a domain error", () => {
  assert.throws(
    () => requireNonEmptyString("   ", "sessionId"),
    (error) => error instanceof AppError && error.code === "invalid_input"
  );
});

test("validates create session input at the service boundary", () => {
  assert.deepEqual(
    validateCreateSessionInput({
      command: " npm test ",
      workspaceId: " workspace-1 "
    }),
    {
      command: "npm test",
      workspaceId: "workspace-1"
    }
  );
});

test("validates preview port at the service boundary", () => {
  assert.equal(validatePreviewPort(4173), 4173);
  assert.equal(validatePreviewPort(null), null);
  assert.throws(
    () => validatePreviewPort(0),
    (error) => error instanceof AppError && error.code === "invalid_input"
  );
});

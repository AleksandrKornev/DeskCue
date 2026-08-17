import assert from "node:assert/strict";
import test from "node:test";

import { AppError, getErrorResponse } from "./errors.ts";

test("maps domain errors to stable HTTP status metadata", () => {
  const response = getErrorResponse(new AppError("not_found", "Session not found."));

  assert.equal(response.code, "not_found");
  assert.equal(response.statusCode, 404);
  assert.equal(response.message, "Session not found.");

  const forbidden = getErrorResponse(new AppError("forbidden", "Workspace path cannot be read."));
  assert.equal(forbidden.code, "forbidden");
  assert.equal(forbidden.statusCode, 403);
});

test("maps unknown errors to invalid input without leaking non-error values", () => {
  const response = getErrorResponse("broken");

  assert.equal(response.code, "invalid_input");
  assert.equal(response.statusCode, 400);
  assert.equal(response.message, "Unexpected error.");
});

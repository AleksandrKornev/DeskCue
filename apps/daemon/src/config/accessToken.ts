import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readOrCreateAccessToken(filePath: string) {
  try {
    const existingToken = readFileSync(filePath, "utf8").trim();
    if (existingToken) {
      return existingToken;
    }
  } catch {
    // Fall through and create a token.
  }

  const token = randomBytes(32).toString("base64url");
  mkdirSync(dirname(filePath), {
    recursive: true
  });
  writeFileSync(filePath, `${token}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  return token;
}

export function createAccessToken() {
  return randomBytes(32).toString("base64url");
}

export function writeAccessToken(filePath: string, token = createAccessToken()) {
  mkdirSync(dirname(filePath), {
    recursive: true
  });
  writeFileSync(filePath, `${token}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  return token;
}

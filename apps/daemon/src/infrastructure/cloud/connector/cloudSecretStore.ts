import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";

const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const SECRET_VERSION = 1;

type EncryptedSecretEnvelope = {
  version: typeof SECRET_VERSION;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type CloudMachineSecret = {
  machineCredential: string;
  privateKey: string;
  enrollmentAttempt?: {
    attemptId: string;
    attemptSecret: string;
    verificationUrl: string;
  };
};

/**
 * Stores Cloud credentials outside SQLite in an authenticated encrypted
 * envelope. The database contains only an opaque reference; plaintext never
 * reaches application logs or diagnostics.
 */
export class EncryptedFileCloudSecretStore {
  private readonly directoryPath: string;
  private readonly masterKeyPath: string;

  constructor(serviceDataPath: string) {
    this.directoryPath = join(serviceDataPath, "cloud-secrets");
    this.masterKeyPath = join(this.directoryPath, "master.key");
  }

  write(reference: string, secret: CloudMachineSecret) {
    const key = this.readOrCreateMasterKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(reference, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secret), "utf8"),
      cipher.final()
    ]);
    const envelope: EncryptedSecretEnvelope = {
      version: SECRET_VERSION,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
    this.writeDurably(this.resolveReference(reference), `${JSON.stringify(envelope)}\n`);
  }

  read(reference: string): CloudMachineSecret {
    const key = this.readOrCreateMasterKey();
    const envelope = JSON.parse(
      readFileSync(this.resolveReference(reference), "utf8")
    ) as EncryptedSecretEnvelope;
    if (
      envelope.version !== SECRET_VERSION ||
      typeof envelope.iv !== "string" ||
      typeof envelope.tag !== "string" ||
      typeof envelope.ciphertext !== "string"
    ) {
      throw new Error("Cloud credential envelope is invalid.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAAD(Buffer.from(reference, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
    const secret = JSON.parse(plaintext) as Partial<CloudMachineSecret>;
    if (
      typeof secret.machineCredential !== "string" ||
      typeof secret.privateKey !== "string" ||
      !secret.privateKey ||
      (secret.enrollmentAttempt !== undefined && (
        typeof secret.enrollmentAttempt.attemptId !== "string" ||
        typeof secret.enrollmentAttempt.attemptSecret !== "string" ||
        typeof secret.enrollmentAttempt.verificationUrl !== "string"
      ))
    ) {
      throw new Error("Cloud credential payload is invalid.");
    }
    return secret as CloudMachineSecret;
  }

  remove(reference: string) {
    try {
      unlinkSync(this.resolveReference(reference));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private readOrCreateMasterKey() {
    mkdirSync(this.directoryPath, { recursive: true, mode: 0o700 });
    if (!existsSync(this.masterKeyPath)) {
      try {
        const descriptor = openSync(this.masterKeyPath, "wx", 0o600);
        try {
          writeFileSync(descriptor, randomBytes(MASTER_KEY_BYTES));
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    chmodSync(this.masterKeyPath, 0o600);
    const key = readFileSync(this.masterKeyPath);
    if (key.byteLength !== MASTER_KEY_BYTES) throw new Error("Cloud credential master key is invalid.");
    return key;
  }

  private resolveReference(reference: string) {
    if (!/^cloud-[a-zA-Z0-9_-]{1,100}\.secret$/.test(reference) || basename(reference) !== reference) {
      throw new Error("Cloud credential reference is invalid.");
    }
    return join(this.directoryPath, reference);
  }

  private writeDurably(targetPath: string, content: string) {
    mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${targetPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    const descriptor = openSync(temporaryPath, "wx", 0o600);
    try {
      writeFileSync(descriptor, content, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, targetPath);
    chmodSync(targetPath, 0o600);
  }
}

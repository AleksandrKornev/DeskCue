import { StringDecoder } from "node:string_decoder";

import { HOST_CONTROL_MAX_FRAME_BYTES } from "./protocol.ts";

export const HOST_CONTROL_REQUEST_END_MARKER = "--deskcue-control-request-end-v1--";

export class BoundedHostControlRequestDecoder {
  private byteLength = 0;
  private committed = false;
  private readonly decoder = new StringDecoder("utf8");
  private request: unknown = null;
  private text = "";

  push(chunk: Buffer) {
    this.byteLength += chunk.length;
    if (this.byteLength > HOST_CONTROL_MAX_FRAME_BYTES) {
      throw new Error("Host control request exceeds the size limit.");
    }

    this.text += this.decoder.write(chunk);
    if (this.committed) {
      if (this.text.length > 0) throw new Error("Host control connection accepts exactly one request.");

      return null;
    }

    while (this.text.includes("\n")) {
      const newlineIndex = this.text.indexOf("\n");
      const line = this.text.slice(0, newlineIndex).trimEnd();

      this.text = this.text.slice(newlineIndex + 1);
      if (this.request === null) {
        this.request = JSON.parse(line) as unknown;
        continue;
      }

      if (line !== HOST_CONTROL_REQUEST_END_MARKER) {
        throw new Error("Host control connection accepts exactly one terminated request.");
      }

      if (this.text.split("\n").some((trailingLine) => trailingLine.trimEnd() === HOST_CONTROL_REQUEST_END_MARKER)) {
        throw new Error("Host control request contains a duplicate terminal marker.");
      }

      this.committed = true;
      this.text = "";
      return this.request;
    }

    return null;
  }

  finish() {
    this.text += this.decoder.end();
    if (this.committed && this.text.length === 0) return null;

    throw new Error("Host control request ended before its terminal marker.");
  }
}

export class BoundedNdjsonDecoder {
  private byteLength = 0;
  private readonly decoder = new StringDecoder("utf8");
  private frameComplete = false;
  private text = "";

  push(chunk: Buffer) {
    this.byteLength += chunk.length;
    if (this.byteLength > HOST_CONTROL_MAX_FRAME_BYTES) {
      throw new Error("Host control frame exceeds the size limit.");
    }

    this.text += this.decoder.write(chunk);
    if (this.frameComplete) {
      if (this.text.trim().length > 0) {
        throw new Error("Host control connection accepts exactly one request.");
      }

      return null;
    }

    const newlineIndex = this.text.indexOf("\n");

    if (newlineIndex < 0) return null;

    const line = this.text.slice(0, newlineIndex).trimEnd();
    const trailingText = this.text.slice(newlineIndex + 1);

    if (trailingText.trim().length > 0) {
      throw new Error("Host control connection accepts exactly one request.");
    }

    this.frameComplete = true;
    this.text = trailingText;

    return JSON.parse(line) as unknown;
  }

  finish() {
    this.text += this.decoder.end();
    if (this.frameComplete) {
      if (this.text.trim().length > 0) {
        throw new Error("Host control connection accepts exactly one request.");
      }

      return null;
    }

    if (!this.text.trim()) return null;

    this.frameComplete = true;
    return JSON.parse(this.text.trim()) as unknown;
  }
}

export function encodeHostControlFrame(value: unknown) {
  const frame = `${JSON.stringify(value)}\n`;

  if (Buffer.byteLength(frame, "utf8") > HOST_CONTROL_MAX_FRAME_BYTES) {
    throw new Error("Host control response exceeds the size limit.");
  }

  return frame;
}

export function encodeHostControlRequestFrame(value: unknown) {
  const frame = `${JSON.stringify(value)}\n${HOST_CONTROL_REQUEST_END_MARKER}\n`;

  if (Buffer.byteLength(frame, "utf8") > HOST_CONTROL_MAX_FRAME_BYTES) {
    throw new Error("Host control request exceeds the size limit.");
  }

  return frame;
}

import styles from "./styles.module.scss";
import type { DebugEntry } from "./types";

export const MAX_VISIBLE_DIFF_FILES = 40;
export const MAX_VISIBLE_DIFF_CHARS = 20_000;

export const hiddenDiffPathPatterns = [
  /^\.tmp-/,
  /^deskcue-.*\.(?:heapsnapshot|json)$/,
  /\.heapsnapshot$/,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /(^|\/)package-lock\.json$/
];

export const debugEntryClassByStream: Record<DebugEntry["stream"], string> = {
  stderr: styles.debugEntryStderr,
  stdout: "",
  system: styles.debugEntrySystem
};

export const debugStreamClassByStream: Record<DebugEntry["stream"], string> = {
  stderr: styles.debugEntryStreamStderr,
  stdout: styles.debugEntryStreamStdout,
  system: styles.debugEntryStreamSystem
};

import { getDiffPathParts } from "./helpers";
import styles from "./styles.module.scss";
import type { DiffPathProps } from "./types";

export function DiffPath({
  displayPath
}: DiffPathProps) {
  const pathParts = getDiffPathParts(displayPath);
  const directoryPart = pathParts.directory ? (
    <span className={styles.diffPathDirectory}>{pathParts.directory}/</span>
  ) : null;

  return (
    <span className={styles.diffPath} title={displayPath}>
      {directoryPart}
      <strong className={styles.diffPathFile}>{pathParts.fileName}</strong>
    </span>
  );
}

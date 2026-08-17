import styles from "./styles.module.scss";

export const DEFAULT_COLLAPSED_DIFF_FILE_LIMIT = 3;

export const diffStatusClassByChangeType = {
  add: styles.diffStatusAdd,
  delete: styles.diffStatusDelete,
  move: styles.diffStatusNeutral,
  unknown: styles.diffStatusNeutral,
  update: styles.diffStatusNeutral
};

export const diffLineClassByTone: Record<string, string> = {
  add: styles.diffLineAdd,
  context: styles.diffLineContext,
  delete: styles.diffLineDelete,
  file: styles.diffLineFile,
  meta: styles.diffLineMeta
};

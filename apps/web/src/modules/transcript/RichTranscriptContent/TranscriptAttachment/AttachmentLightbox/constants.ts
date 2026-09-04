import type { AttachmentPreviewKind } from "@modules/transcript/RichTranscriptContent/types";

import styles from "./styles.module.scss";

export const lightboxBodyClassByKind: Record<AttachmentPreviewKind, string> = {
  audio: styles.lightboxBodyMedia,
  image: "",
  none: "",
  pdf: styles.lightboxBodyPdf,
  text: styles.lightboxBodyText,
  video: styles.lightboxBodyMedia
};

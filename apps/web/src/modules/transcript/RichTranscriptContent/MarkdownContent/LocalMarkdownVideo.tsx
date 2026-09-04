import { assetsApi } from "@api/endpoint/assets/endpoints";

import styles from "./styles.module.scss";
import type { LocalMarkdownVideoProps } from "./types";

export function LocalMarkdownVideo({
  assetContext,
  assetPath,
  label
}: LocalMarkdownVideoProps) {
  return (
    <video
      aria-label={label}
      className={styles.localVideo}
      controls
      playsInline
      preload="metadata"
      src={assetsApi.buildFileUrl(assetPath, { context: assetContext })}
    />
  );
}

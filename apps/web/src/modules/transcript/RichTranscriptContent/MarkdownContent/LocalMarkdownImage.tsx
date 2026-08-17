import { useEffect, useState } from "react";

import { assetsApi } from "@api/endpoint/assets/endpoints";

import styles from "./styles.module.scss";
import type { LocalMarkdownImageProps } from "./types";

export function LocalMarkdownImage({
  alt,
  assetContext,
  assetPath
}: LocalMarkdownImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const fetchBlob = assetContext
      ? assetsApi.getTicketBlob(assetPath, alt || assetPath, {
          context: assetContext,
          kind: "local_image"
        })
      : assetsApi.getImageBlob(assetsApi.buildImageUrl(assetPath), alt || assetPath);

    fetchBlob
      .then((blob) => {
        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setImageUrl(null);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [alt, assetContext, assetPath]);

  if (!imageUrl) {
    return <span className={styles.localLink} title={assetPath}>Local image unavailable</span>;
  }

  return <img alt={alt} loading="lazy" src={imageUrl} />;
}

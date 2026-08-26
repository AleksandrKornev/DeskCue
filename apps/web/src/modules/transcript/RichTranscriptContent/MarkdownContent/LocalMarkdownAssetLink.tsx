import { useState } from "react";
import type { ReactNode } from "react";

import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";

import { LocalAssetActionDialog } from "./LocalAssetActionDialog";
import styles from "./styles.module.scss";

interface LocalMarkdownAssetLinkProps {
  assetContext?: LocalAssetLinkContext;
  assetPath: string;
  children: ReactNode;
  displayName: string;
}

export function LocalMarkdownAssetLink({
  assetContext,
  assetPath,
  children,
  displayName
}: LocalMarkdownAssetLinkProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <button
        className={styles.localAssetButton}
        onClick={() => setDialogOpen(true)}
        title={assetPath}
        type="button"
      >
        {children}
      </button>

      <LocalAssetActionDialog
        assetContext={assetContext}
        assetPath={assetPath}
        displayName={displayName}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}

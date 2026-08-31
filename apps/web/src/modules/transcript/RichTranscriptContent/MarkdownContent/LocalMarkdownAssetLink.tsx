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

function createLocalAssetDialogKey({
  assetContext,
  assetPath,
  displayName
}: Pick<LocalMarkdownAssetLinkProps, "assetContext" | "assetPath" | "displayName">) {
  return [
    assetContext?.agentSessionId,
    assetContext?.managedSessionId,
    assetContext?.workspaceId,
    assetPath,
    displayName
  ].join("\u0000");
}

export function LocalMarkdownAssetLink({
  assetContext,
  assetPath,
  children,
  displayName
}: LocalMarkdownAssetLinkProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogKey = createLocalAssetDialogKey({ assetContext, assetPath, displayName });

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

      {dialogOpen ? (
        <LocalAssetActionDialog
          key={dialogKey}
          assetContext={assetContext}
          assetPath={assetPath}
          displayName={displayName}
          isOpen
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </>
  );
}

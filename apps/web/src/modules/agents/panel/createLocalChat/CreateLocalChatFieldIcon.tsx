import FolderIcon from "@assets/images/icon-folder.svg?react";
import SearchIcon from "@assets/images/icon-search.svg?react";

export type CreateLocalChatFieldIconProps = {
  kind: "model" | "workspace";
};

export function CreateLocalChatFieldIcon({ kind }: CreateLocalChatFieldIconProps) {
  if (kind === "model") {
    return <SearchIcon aria-hidden="true" focusable="false" />;
  }

  return <FolderIcon aria-hidden="true" focusable="false" />;
}

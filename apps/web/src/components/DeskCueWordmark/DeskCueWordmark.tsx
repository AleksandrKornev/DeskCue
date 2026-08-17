import clsx from "clsx";

import DeskCueWordmarkSvg from "@assets/images/deskcue-wordmark.svg?react";

import styles from "./styles.module.scss";

type DeskCueWordmarkProps = {
  className?: string;
};

export function DeskCueWordmark({ className }: DeskCueWordmarkProps) {
  return (
    <DeskCueWordmarkSvg
      aria-hidden="true"
      className={clsx(styles.wordmark, className)}
      focusable="false"
    />
  );
}
